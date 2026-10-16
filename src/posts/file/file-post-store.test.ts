import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFileSystem, type FileSystem, FileSystemError } from '../../file-system/file-system';
import { describePostStore } from '../components/describe-post-store';
import { PostError } from '../post-error';
import { createFilePostStore } from './file-post-store';

// The local file system with some methods replaced. createLocalFileSystem returns a plain object, so spreading it
// keeps every other method working.
function wrap(fileSystem: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return { ...fileSystem, ...overrides };
}

// The underlying watch is turned off, so the only signals the suite sees are the store's own-write signals.
describePostStore('file', async () => {
  const root = await mkdtemp(join(tmpdir(), '3pitor-posts-'));
  const fileSystem = wrap(createLocalFileSystem(root), { watch: () => () => {} });
  return { store: createFilePostStore(fileSystem), dispose: () => rm(root, { recursive: true, force: true }) };
});

describe('file store', () => {
  let root: string;
  let fileSystem: FileSystem;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), '3pitor-posts-'));
    fileSystem = createLocalFileSystem(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // A post folder written straight to disk, the way posts exist today: a folder holding draft.md.
  async function onDisk(key: string, files: Record<string, string> = { 'draft.md': '' }) {
    await mkdir(join(root, key), { recursive: true });
    for (const [name, text] of Object.entries(files)) await writeFile(join(root, key, name), text);
  }

  const titled = { 'draft.md': '', '.post.json': '{"title":"T"}' };

  const ids = async (store: ReturnType<typeof createFilePostStore>) => (await store.list()).posts.map((post) => post.id).sort();

  test('a post in a nested folder is listed under its full key and can be got', async () => {
    await onDisk('series/one', { 'draft.md': 'first', '.post.json': '{"title":"One"}' });
    const store = createFilePostStore(fileSystem);
    expect(await store.list()).toEqual({ posts: [{ id: 'series/one', title: 'One' }] });
    expect(await store.get('series/one')).toEqual({ id: 'series/one', title: 'One', body: 'first' });
  });

  test('a post without a usable title file takes its folder name, or Untitled when that is blank', async () => {
    await onDisk('series/missing');
    await onDisk('not json', { 'draft.md': '', '.post.json': '{' });
    await onDisk('no title', { 'draft.md': '', '.post.json': '{"name":"x"}' });
    await onDisk('blank title', { 'draft.md': '', '.post.json': '{"title":"  "}' });
    await onDisk('folder title/.post.json');
    await writeFile(join(root, 'folder title', 'draft.md'), '');
    await onDisk('   ');
    const store = createFilePostStore(fileSystem);
    const titles = Object.fromEntries((await store.list()).posts.map((post) => [post.id, post.title]));
    expect(titles).toEqual({
      'series/missing': 'missing',
      'not json': 'not json',
      'no title': 'no title',
      'blank title': 'blank title',
      'folder title': 'folder title',
      '   ': 'Untitled',
    });
    expect((await store.get('series/missing')).title).toBe('missing');
  });

  test('a folder inside a post is not a post, and a draft.md at the root hides nothing', async () => {
    await onDisk('outer', titled);
    await onDisk('outer/inner', titled);
    await writeFile(join(root, 'draft.md'), '');
    const store = createFilePostStore(fileSystem);
    expect(await ids(store)).toEqual(['outer']);
    await expect(store.get('outer/inner')).rejects.toThrow(new PostError('not-found'));
    expect((await store.get('outer')).id).toBe('outer');
  });

  test('a folder whose name the file system cannot address is skipped by list and not-found when got', async () => {
    await onDisk('back\\slash', titled);
    await onDisk('kept', titled);
    const store = createFilePostStore(fileSystem);
    expect(await ids(store)).toEqual(['kept']);
    await expect(store.get('back\\slash')).rejects.toThrow(new PostError('not-found'));
  });

  test('a folder that vanishes while list walks is skipped', async () => {
    await onDisk('gone', titled);
    await onDisk('kept', titled);
    const local = createLocalFileSystem(root);
    const vanishing = wrap(local, {
      list: (key) => (key === 'gone' ? Promise.reject(new FileSystemError('not-found', 'gone was not found')) : local.list(key)),
    });
    expect(await ids(createFilePostStore(vanishing))).toEqual(['kept']);
  });

  test('a folder whose draft.md is not a regular file is not a post', async () => {
    await mkdir(join(root, 'odd', 'draft.md'), { recursive: true });
    const store = createFilePostStore(fileSystem);
    expect(await ids(store)).toEqual([]);
    await expect(store.get('odd')).rejects.toThrow(new PostError('not-found'));
  });

  test('a link to a post folder is never followed, by list or by an id that goes through it', async () => {
    await onDisk('real/post', titled);
    await symlink(join(root, 'real'), join(root, 'via'));
    const store = createFilePostStore(fileSystem);
    expect(await ids(store)).toEqual(['real/post']);
    await expect(store.get('via/post')).rejects.toThrow(new PostError('not-found'));
  });

  test('a missing workspace root fails list as a storage failure, and is not-found from get', async () => {
    const store = createFilePostStore(createLocalFileSystem(join(root, 'gone')));
    const failure = await store.list().then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(FileSystemError);
    expect(failure).not.toBeInstanceOf(PostError);
    await expect(store.get('anything')).rejects.toThrow(new PostError('not-found'));
  });

  test('an id the file system would refuse, or with a hidden segment, is not-found from every addressed call', async () => {
    await onDisk('a/b', titled);
    await onDisk('x', titled);
    const store = createFilePostStore(fileSystem);
    for (const id of ['../x', 'a//b', '/a', 'a\\b', '.', '.hidden', 'x/']) {
      const failure = await store.get(id).then(() => undefined, (error: unknown) => error);
      expect({ id, failure }).toEqual({ id, failure: new PostError('not-found') });
      expect(failure).toBeInstanceOf(PostError);
    }
  });

  test('a name this store deleted is skipped by create', async () => {
    const store = createFilePostStore(fileSystem);
    const first = await store.create({ title: 'Reused', body: '' });
    await store.delete(first);
    expect(first).toBe('Reused');
    expect(await store.create({ title: 'Reused', body: '' })).toBe('Reused 2');
  });

  test('a folder another writer makes at a deleted key stays invisible, but a post nested under it is found', async () => {
    const store = createFilePostStore(fileSystem);
    const id = await store.create({ title: 'series', body: '' });
    await store.delete(id);
    await onDisk('series', titled);
    expect(await ids(store)).toEqual([]);
    await expect(store.get('series')).rejects.toThrow(new PostError('not-found'));
    await rm(join(root, 'series', 'draft.md'));
    await onDisk('series/one', titled);
    expect(await ids(store)).toEqual(['series/one']);
    expect((await store.get('series/one')).id).toBe('series/one');
  });

  test('a post folder that vanishes between the check and the act is not-found from get and delete', async () => {
    await onDisk('fleeting', titled);
    const local = createLocalFileSystem(root);
    const missing = () => Promise.reject(new FileSystemError('not-found', 'fleeting was not found'));
    const store = createFilePostStore(wrap(local, { read: (key) => (key.endsWith('draft.md') ? missing() : local.read(key)), delete: missing }));
    await expect(store.get('fleeting')).rejects.toThrow(new PostError('not-found'));
    await expect(store.delete('fleeting')).rejects.toThrow(new PostError('not-found'));
    await expect(store.get('fleeting')).rejects.toThrow(new PostError('not-found'));
  });

  test('folders with a hidden name, or under one, are not posts', async () => {
    await onDisk('.3pitor');
    await onDisk('drafts/.trash/old');
    await onDisk('kept', { 'draft.md': '', '.post.json': '{"title":"Kept"}' });
    const store = createFilePostStore(fileSystem);
    expect(await ids(store)).toEqual(['kept']);
    for (const id of ['.3pitor', 'drafts/.trash/old']) await expect(store.get(id)).rejects.toThrow(new PostError('not-found'));
  });

  test('a body holding NUL round-trips through the file store', async () => {
    const store = createFilePostStore(fileSystem);
    const id = await store.create({ title: 'Nul', body: 'a\u0000b' });
    expect((await store.get(id)).body).toBe('a\u0000b');
  });
});

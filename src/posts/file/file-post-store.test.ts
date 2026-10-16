import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFileSystem, type FileSystem } from '../../file-system/file-system';
import { describePostStore } from '../components/describe-post-store';
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

  test('a body holding NUL round-trips through the file store', async () => {
    const store = createFilePostStore(fileSystem);
    const id = await store.create({ title: 'Nul', body: 'a\u0000b' });
    expect((await store.get(id)).body).toBe('a\u0000b');
  });
});

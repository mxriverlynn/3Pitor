import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import * as fsPromises from 'node:fs/promises';
import { chmod, mkdtemp, mkdir, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postName } from '../chat/tools/tools';
import { checkPath, countContents, createEntry, deleteEntry, DocumentError, listEntries, moveEntry, readDocument, writeDocument } from './documents';

let root: string;
let workspace: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), '3pitor-documents-')));
  workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'notes.md'), '# Notes\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// Whether checkPath accepts a path as that kind of item.
const accepts = (path: string, kind: 'file' | 'folder') => {
  try {
    checkPath(path, kind);
    return true;
  } catch {
    return false;
  }
};

test.each([
  ['drafts/2026/soil.md', true, true],
  ['drafts/2026', false, true],
  ['notes.txt', false, true],
  ['my notes.md', true, true],
  ['.claude', false, false],
  ['drafts/.hidden.md', false, false],
  ['a/../b.md', false, false],
  ['drafts/', false, false],
  ['/notes.md', false, false],
  ['.', false, false],
  ['', false, false],
  ['drafts//soil.md', false, false],
  ['drafts\\soil.md', false, false],
  ['soil\0.md', false, false],
])('the path grammar takes %p as a file: %p, as a folder: %p', (path, asFile, asFolder) => {
  expect([accepts(path, 'file'), accepts(path, 'folder')]).toEqual([asFile, asFolder]);
});

// The reason and message a rejected documents call gave.
const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof DocumentError)) throw new Error(`expected a DocumentError, got ${error}`);
  return { reason: error.reason, message: error.message };
};

test('reads a file inside a folder', async () => {
  await mkdir(join(workspace, 'drafts/2026'), { recursive: true });
  await writeFile(join(workspace, 'drafts/2026/soil.md'), '# Soil\n');
  expect(await readDocument(workspace, 'drafts/2026/soil.md')).toBe('# Soil\n');
});

test('reports a missing file as not found', async () => {
  expect(await refusal(readDocument(workspace, 'nope.md'))).toEqual({ reason: 'not-found', message: 'nope.md was not found' });
});

test('refuses to read a file that is a symlink, whether its target exists or not', async () => {
  await symlink(join(workspace, 'notes.md'), join(workspace, 'todo.md'));
  await symlink(join(root, 'nowhere.md'), join(workspace, 'dangling.md'));
  expect(await refusal(readDocument(workspace, 'todo.md'))).toEqual({ reason: 'invalid', message: 'todo.md is a symlink' });
  expect(await refusal(readDocument(workspace, 'dangling.md'))).toEqual({ reason: 'invalid', message: 'dangling.md is a symlink' });
});

test('refuses a path through a symlinked folder that leads outside the workspace', async () => {
  await mkdir(join(root, 'elsewhere'));
  await writeFile(join(root, 'elsewhere/secret.md'), 'secret\n');
  await symlink(join(root, 'elsewhere'), join(workspace, 'escape'));
  expect(await refusal(readDocument(workspace, 'escape/secret.md'))).toEqual({
    reason: 'invalid',
    message: 'escape/secret.md is outside the workspace',
  });
});

test('writes over an existing file, and creates the folders a new file needs', async () => {
  await writeDocument(workspace, 'notes.md', '# Garden\n');
  await writeDocument(workspace, 'drafts/2026/soil.md', '# Soil\n');
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Garden\n');
  expect(await Bun.file(join(workspace, 'drafts/2026/soil.md')).text()).toBe('# Soil\n');
});

test('refuses to write through a dangling symlink, so nothing lands outside the workspace', async () => {
  await symlink(join(root, 'outside.md'), join(workspace, 'dangling.md'));
  expect(await refusal(writeDocument(workspace, 'dangling.md', 'x'))).toEqual({ reason: 'invalid', message: 'dangling.md is a symlink' });
  expect(await Bun.file(join(root, 'outside.md')).exists()).toBe(false);
});

// Every open file's name goes to the chat, whose tools refuse a name they would not call a post.
test('the chat tools name every file the path grammar accepts the same way', () => {
  for (const name of ['notes.md', 'drafts/2026/soil.md', 'my notes.md', 'drafts/new idea.md']) {
    checkPath(name, 'file');
    expect(postName(workspace, name)).toBe(name);
  }
});

test('lists every folder and markdown file, skipping dot-names, other files, and symlinks', async () => {
  await writeFile(join(workspace, 'ideas.md'), '# Ideas\n');
  await mkdir(join(workspace, 'drafts/2026'), { recursive: true });
  await writeFile(join(workspace, 'drafts/2026/soil.md'), '# Soil\n');
  await writeFile(join(workspace, 'drafts/cover.png'), '');
  await mkdir(join(workspace, 'archive'));
  await mkdir(join(workspace, '.claude'));
  await writeFile(join(workspace, '.claude/notes.md'), '');
  await symlink(join(workspace, 'notes.md'), join(workspace, 'todo.md'));
  await symlink(join(workspace, 'drafts'), join(workspace, 'shortcut'));

  expect(await listEntries(workspace)).toEqual([
    { path: 'archive', kind: 'folder' },
    { path: 'drafts', kind: 'folder' },
    { path: 'drafts/2026', kind: 'folder' },
    { path: 'drafts/2026/soil.md', kind: 'file' },
    { path: 'ideas.md', kind: 'file' },
    { path: 'notes.md', kind: 'file' },
  ]);
});

// Makes readdir fail with `code` for one folder, as when it vanishes while the walk is under way; every other call
// reaches the real file system. The failure lasts until the test ends.
let failingFolder: { full: string; code: string } | undefined;
const realReaddir = fsPromises.readdir;
mock.module('node:fs/promises', () => ({
  ...fsPromises,
  readdir: (path: string, options?: unknown) => {
    if (path === failingFolder?.full) {
      return Promise.reject(Object.assign(new Error(`${failingFolder.code}: ${path}`), { code: failingFolder.code }));
    }
    return (realReaddir as (path: string, options?: unknown) => Promise<unknown>)(path, options);
  },
}));
afterEach(() => {
  failingFolder = undefined;
});

// ENOENT: the folder was deleted. ENOTDIR: it was replaced by a file.
test.each(['ENOENT', 'ENOTDIR'])('lists the rest of the workspace when a folder fails with %s during the walk', async (code) => {
  await mkdir(join(workspace, 'drafts/2026'), { recursive: true });
  await mkdir(join(workspace, 'archive'));
  failingFolder = { full: join(workspace, 'drafts'), code };

  expect(await listEntries(workspace)).toEqual([
    { path: 'archive', kind: 'folder' },
    { path: 'drafts', kind: 'folder' },
    { path: 'notes.md', kind: 'file' },
  ]);
});

test('fails to list a workspace whose folder is gone', async () => {
  failingFolder = { full: workspace, code: 'ENOENT' };
  await expect(listEntries(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
});

// Only a vanished folder is skipped; one the walk may not read still fails the list. Root reads anything, so it is skipped.
test.skipIf(process.getuid?.() === 0)('fails to list a workspace with a folder it may not read', async () => {
  await mkdir(join(workspace, 'drafts'));
  await chmod(join(workspace, 'drafts'), 0o000);
  try {
    await expect(listEntries(workspace)).rejects.toMatchObject({ code: 'EACCES' });
  } finally {
    await chmod(join(workspace, 'drafts'), 0o755);
  }
});

test('creates an empty folder, and a file that starts with its name as a heading', async () => {
  await createEntry(workspace, 'drafts', 'folder');
  await createEntry(workspace, 'drafts/soil.md', 'file');
  await createEntry(workspace, 'drafts/2026', 'folder');

  expect(await readdir(join(workspace, 'drafts/2026'))).toEqual([]);
  expect(await Bun.file(join(workspace, 'drafts/soil.md')).text()).toBe('# soil\n');
});

test('refuses to create over anything already there, and leaves it alone', async () => {
  await mkdir(join(workspace, 'drafts'));
  expect(await refusal(createEntry(workspace, 'notes.md', 'file'))).toEqual({ reason: 'invalid', message: 'notes.md already exists' });
  expect(await refusal(createEntry(workspace, 'drafts', 'folder'))).toEqual({ reason: 'invalid', message: 'drafts already exists' });
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Notes\n');
});

test('refuses to create inside a folder that does not exist', async () => {
  expect(await refusal(createEntry(workspace, 'drafts/soil.md', 'file'))).toEqual({ reason: 'not-found', message: 'drafts was not found' });
  expect(await refusal(createEntry(workspace, 'drafts/2026', 'folder'))).toEqual({ reason: 'not-found', message: 'drafts was not found' });
});

test('renames a file, and moves a folder with everything inside it', async () => {
  await mkdir(join(workspace, 'drafts/2026'), { recursive: true });
  await writeFile(join(workspace, 'drafts/2026/soil.md'), '# Soil\n');
  await mkdir(join(workspace, 'archive'));

  await moveEntry(workspace, 'notes.md', 'garden.md');
  await moveEntry(workspace, 'drafts', 'archive/drafts');

  expect(await listEntries(workspace)).toEqual([
    { path: 'archive', kind: 'folder' },
    { path: 'archive/drafts', kind: 'folder' },
    { path: 'archive/drafts/2026', kind: 'folder' },
    { path: 'archive/drafts/2026/soil.md', kind: 'file' },
    { path: 'garden.md', kind: 'file' },
  ]);
});

test('refuses a move from a missing item, or into a missing folder', async () => {
  expect(await refusal(moveEntry(workspace, 'nope.md', 'x.md'))).toEqual({ reason: 'not-found', message: 'nope.md was not found' });
  expect(await refusal(moveEntry(workspace, 'notes.md', 'drafts/notes.md'))).toEqual({ reason: 'not-found', message: 'drafts was not found' });
});

test('refuses a move onto anything already there, and leaves both alone', async () => {
  await writeFile(join(workspace, 'ideas.md'), '# Ideas\n');
  expect(await refusal(moveEntry(workspace, 'notes.md', 'ideas.md'))).toEqual({ reason: 'invalid', message: 'ideas.md already exists' });
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Notes\n');
  expect(await Bun.file(join(workspace, 'ideas.md')).text()).toBe('# Ideas\n');
});

test('refuses to move a folder onto itself or into a folder inside it', async () => {
  await mkdir(join(workspace, 'drafts/2026'), { recursive: true });
  const intoItself = { reason: 'invalid', message: 'drafts cannot move into itself' } as const;
  expect(await refusal(moveEntry(workspace, 'drafts', 'drafts'))).toEqual(intoItself);
  expect(await refusal(moveEntry(workspace, 'drafts', 'drafts/2026/drafts'))).toEqual(intoItself);
});

test('refuses to give a file a name that is not markdown, or a folder a hidden name', async () => {
  await mkdir(join(workspace, 'drafts'));
  expect((await refusal(moveEntry(workspace, 'notes.md', 'notes.txt'))).reason).toBe('invalid');
  expect((await refusal(moveEntry(workspace, 'drafts', '.drafts'))).reason).toBe('invalid');
  expect((await refusal(moveEntry(workspace, '../x.md', 'x.md'))).reason).toBe('invalid');
  expect(await Bun.file(join(workspace, 'notes.md')).exists()).toBe(true);
});

test('moves a symlink as a link, leaving its target where it was', async () => {
  await mkdir(join(workspace, 'drafts'));
  await symlink(join(workspace, 'notes.md'), join(workspace, 'todo.md'));

  await moveEntry(workspace, 'todo.md', 'drafts/todo.md');

  expect(await readdir(join(workspace, 'drafts'))).toEqual(['todo.md']);
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Notes\n');
});

test('renames a file to the same name in other letter case', async () => {
  await moveEntry(workspace, 'notes.md', 'Notes.md');
  expect(await readdir(workspace)).toEqual(['Notes.md']);
});

// drafts/ holding a post, a hidden file, a picture, a link to a folder outside, and a sub-folder holding a post.
async function fillDrafts() {
  await mkdir(join(root, 'elsewhere'));
  await writeFile(join(root, 'elsewhere/keep.md'), '# Keep\n');
  await mkdir(join(workspace, 'drafts/2026'), { recursive: true });
  await writeFile(join(workspace, 'drafts/soil.md'), '# Soil\n');
  await writeFile(join(workspace, 'drafts/.notes'), '');
  await writeFile(join(workspace, 'drafts/cover.png'), '');
  await symlink(join(root, 'elsewhere'), join(workspace, 'drafts/elsewhere'));
  await writeFile(join(workspace, 'drafts/2026/seeds.md'), '# Seeds\n');
}

test('counts everything a delete would remove, hidden and non-markdown items and links included', async () => {
  await fillDrafts();
  expect(await countContents(workspace, 'drafts')).toEqual({ files: 5, folders: 1 });
});

test('deletes a file, and a folder with everything in it, removing a link inside as a link only', async () => {
  await fillDrafts();

  await deleteEntry(workspace, 'notes.md');
  await deleteEntry(workspace, 'drafts');

  expect(await readdir(workspace)).toEqual([]);
  expect(await Bun.file(join(root, 'elsewhere/keep.md')).text()).toBe('# Keep\n');
});

test('reports deleting or counting a missing item as not found', async () => {
  expect(await refusal(deleteEntry(workspace, 'drafts'))).toEqual({ reason: 'not-found', message: 'drafts was not found' });
  expect(await refusal(countContents(workspace, 'drafts'))).toEqual({ reason: 'not-found', message: 'drafts was not found' });
});

test('deleting a symlink removes the link and leaves what it points at', async () => {
  await symlink(join(workspace, 'notes.md'), join(workspace, 'todo.md'));
  await deleteEntry(workspace, 'todo.md');
  expect(await readdir(workspace)).toEqual(['notes.md']);
});

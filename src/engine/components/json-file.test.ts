import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readJson, stateFile, writeJson, writeText } from './json-file';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-json-file-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test('several writes to one path, started without awaiting, leave the last value and no temp file', async () => {
  const path = stateFile(workspace, 'view.json');
  const writes = [1, 2, 3, 4, 5].map((n) => writeJson(path, { n }));
  await Promise.all(writes);
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ n: 5 });
  expect((await readdir(join(workspace, '.3pitor'))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
});

test('a failed write rejects for its own caller, and a later write to the same path still succeeds', async () => {
  const path = stateFile(workspace, 'view.json');
  // A non-empty folder where the file should be makes the rename fail.
  await mkdir(join(path, 'blocker'), { recursive: true });
  await expect(writeJson(path, { n: 1 })).rejects.toThrow();
  await rm(path, { recursive: true });
  await writeJson(path, { n: 2 });
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ n: 2 });
});

test('a missing file reads as undefined', async () => {
  expect(await readJson(stateFile(workspace, 'session.json'))).toBeUndefined();
});

test('an unparseable file reads as undefined, with a warning', async () => {
  const path = stateFile(workspace, 'session.json');
  await mkdir(join(workspace, '.3pitor'));
  await writeFile(path, '{ not json');
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(await readJson(path)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});

test('a written value reads back', async () => {
  const path = stateFile(workspace, 'session.json');
  await writeJson(path, { id: 'a', messages: [] });
  expect(await readJson(path)).toEqual({ id: 'a', messages: [] });
});

test('the first write keeps .3pitor out of git with a .gitignore of *', async () => {
  await writeJson(stateFile(workspace, 'view.json'), {});
  expect(await readFile(join(workspace, '.3pitor', '.gitignore'), 'utf8')).toBe('*\n');
});

test('a .gitignore already in .3pitor is left alone', async () => {
  await mkdir(join(workspace, '.3pitor'));
  await writeFile(join(workspace, '.3pitor', '.gitignore'), '*.tmp\n');
  await writeJson(stateFile(workspace, 'view.json'), {});
  expect(await readFile(join(workspace, '.3pitor', '.gitignore'), 'utf8')).toBe('*.tmp\n');
});

test('several text writes to one path, started without awaiting, leave the last text and no temp file', async () => {
  const path = join(workspace, '.3pitor', 'editing', 'log.md');
  const writes = ['one\n', 'two\n', 'three\n'].map((text) => writeText(path, text));
  await Promise.all(writes);
  expect(await readFile(path, 'utf8')).toBe('three\n');
  expect((await readdir(dirname(path))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
});

test('a text write to a missing folder creates it, with a .gitignore of *', async () => {
  const path = join(workspace, '.3pitor', 'editing', 'log.md');
  await writeText(path, '# Log\n');
  expect(await readFile(path, 'utf8')).toBe('# Log\n');
  expect(await readFile(join(dirname(path), '.gitignore'), 'utf8')).toBe('*\n');
});

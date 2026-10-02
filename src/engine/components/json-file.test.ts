import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFileSystem, type FileSystem } from '../../file-system/file-system';
import { readJson, stateKey, writeJson, writeText } from './json-file';

let workspace: string;
let fileSystem: FileSystem;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-json-file-'));
  fileSystem = createLocalFileSystem(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test('a missing file reads as undefined', async () => {
  expect(await readJson(fileSystem, stateKey('session.json'))).toBeUndefined();
});

test('an unparseable file reads as undefined, with a warning that names its key', async () => {
  await mkdir(join(workspace, '.3pitor'));
  await writeFile(join(workspace, '.3pitor', 'session.json'), '{ not json');
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(await readJson(fileSystem, stateKey('session.json'))).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toStartWith('Could not read .3pitor/session.json: ');
  } finally {
    warn.mockRestore();
  }
});

test('a written value reads back', async () => {
  await writeJson(fileSystem, stateKey('session.json'), { id: 'a', messages: [] });
  expect(await readJson(fileSystem, stateKey('session.json'))).toEqual({ id: 'a', messages: [] });
});

test('the first write keeps .3pitor out of git with a .gitignore of *', async () => {
  await writeJson(fileSystem, stateKey('view.json'), {});
  expect(await readFile(join(workspace, '.3pitor', '.gitignore'), 'utf8')).toBe('*\n');
});

test('a .gitignore already in .3pitor is left alone', async () => {
  await mkdir(join(workspace, '.3pitor'));
  await writeFile(join(workspace, '.3pitor', '.gitignore'), '*.tmp\n');
  await writeJson(fileSystem, stateKey('view.json'), {});
  expect(await readFile(join(workspace, '.3pitor', '.gitignore'), 'utf8')).toBe('*.tmp\n');
});

test('a note in a nested folder is written, and only .3pitor gets a .gitignore', async () => {
  await writeText(fileSystem, '.3pitor/editing/log.md', '# Log\n');
  expect(await readFile(join(workspace, '.3pitor', 'editing', 'log.md'), 'utf8')).toBe('# Log\n');
  expect(await readFile(join(workspace, '.3pitor', '.gitignore'), 'utf8')).toBe('*\n');
  expect(await readdir(join(workspace, '.3pitor', 'editing'))).toEqual(['log.md']);
});

test('several text writes to one key, started without awaiting, leave the last text', async () => {
  const writes = ['one\n', 'two\n', 'three\n'].map((text) => writeText(fileSystem, '.3pitor/editing/log.md', text));
  await Promise.all(writes);
  expect(await readFile(join(workspace, '.3pitor', 'editing', 'log.md'), 'utf8')).toBe('three\n');
});

test('a .gitignore that cannot be written fails that write only', async () => {
  const write = fileSystem.write.bind(fileSystem);
  const spy = spyOn(fileSystem, 'write').mockImplementation((key, text) =>
    key === '.3pitor/.gitignore' ? Promise.reject(new Error('disk full')) : write(key, text),
  );
  await expect(writeJson(fileSystem, stateKey('view.json'), { n: 1 })).rejects.toThrow('disk full');
  spy.mockRestore();
  await writeJson(fileSystem, stateKey('view.json'), { n: 2 });
  expect(await readJson(fileSystem, stateKey('view.json'))).toEqual({ n: 2 });
});

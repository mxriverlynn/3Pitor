import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseWorkspace } from './workspace';

let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), '3pitor-workspace-')));
  await mkdir(join(root, 'my-stuff'));
  await writeFile(join(root, 'my-stuff', 'post.md'), '# Post\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test('uses a named folder as the workspace', async () => {
  expect(await chooseWorkspace(join(root, 'my-stuff'))).toBe(join(root, 'my-stuff'));
});

test('uses the folder that holds a named file', async () => {
  expect(await chooseWorkspace(join(root, 'my-stuff', 'post.md'))).toBe(join(root, 'my-stuff'));
});

test('falls back to the launch folder, with a warning, when the name does not exist', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(await chooseWorkspace(join(root, 'nope'))).toBe(process.cwd());
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});

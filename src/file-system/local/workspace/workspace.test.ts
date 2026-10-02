import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseWorkspace, resetWorkspace } from './workspace';

const none = { workspaceEnv: undefined, fixture: '' };

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
  expect(await chooseWorkspace(join(root, 'my-stuff'), none)).toBe(join(root, 'my-stuff'));
});

test('uses the folder that holds a named file', async () => {
  expect(await chooseWorkspace(join(root, 'my-stuff', 'post.md'), none)).toBe(join(root, 'my-stuff'));
});

test('falls back to the launch folder, with a warning, when the name does not exist', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(await chooseWorkspace(join(root, 'nope'), none)).toBe(process.cwd());
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});

test('with no name, seeds the WORKSPACE folder from the fixture only when it is absent', async () => {
  const fixture = join(root, 'fixture');
  await mkdir(fixture);
  await writeFile(join(fixture, 'seed.md'), 'seed');
  const workspace = join(root, 'env-workspace');
  expect(await chooseWorkspace(undefined, { workspaceEnv: workspace, fixture })).toBe(workspace);
  expect(await readdir(workspace)).toEqual(['seed.md']);
  await writeFile(join(workspace, 'seed.md'), 'edited');
  await chooseWorkspace(undefined, { workspaceEnv: workspace, fixture });
  expect(await readFile(join(workspace, 'seed.md'), 'utf8')).toBe('edited');
});

test('with no name and no WORKSPACE, uses the launch folder', async () => {
  expect(await chooseWorkspace(undefined, none)).toBe(process.cwd());
});

test('resetWorkspace wipes the folder and re-seeds it from the fixture', async () => {
  const fixture = join(root, 'fixture-2');
  await mkdir(fixture);
  await writeFile(join(fixture, 'seed.md'), 'seed');
  const workspace = join(root, 'reset-workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'stale.md'), 'stale');
  await resetWorkspace(workspace, fixture);
  expect(await readdir(workspace)).toEqual(['seed.md']);
});

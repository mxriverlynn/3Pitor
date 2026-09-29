import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveInWorkspace } from './workspace-path';

let root: string;
let workspace: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), '3pitor-workspace-path-')));
  workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'notes.md'), '# Notes\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('resolves a path inside the workspace to its real location', () => {
  expect(resolveInWorkspace(workspace, 'notes.md')).toBe(join(workspace, 'notes.md'));
});

test('refuses a path that climbs out of the workspace with ..', () => {
  expect(() => resolveInWorkspace(workspace, '../secret.md')).toThrow('../secret.md is outside the workspace');
});

test('refuses an absolute path outside the workspace', () => {
  const outside = join(root, 'secret.md');
  expect(() => resolveInWorkspace(workspace, outside)).toThrow(`${outside} is outside the workspace`);
});

test('refuses a symlink inside the workspace that points out of it', async () => {
  await writeFile(join(root, 'secret.md'), 'secret\n');
  await symlink(join(root, 'secret.md'), join(workspace, 'link.md'));
  expect(() => resolveInWorkspace(workspace, 'link.md')).toThrow('link.md is outside the workspace');
});

test('resolves a new file under a new folder inside the workspace', () => {
  expect(resolveInWorkspace(workspace, 'drafts/2026/post.md')).toBe(join(workspace, 'drafts/2026/post.md'));
});

test('refuses a new file under a symlinked folder that points out of the workspace', async () => {
  await mkdir(join(root, 'elsewhere'));
  await symlink(join(root, 'elsewhere'), join(workspace, 'escape'));
  expect(() => resolveInWorkspace(workspace, 'escape/new/post.md')).toThrow('escape/new/post.md is outside the workspace');
});

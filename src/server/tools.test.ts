import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from 'ai';
import { fileTools, resolveInWorkspace } from './tools';

let root: string;
let workspace: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), '3pitor-tools-')));
  workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'notes.md'), '# Notes\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// Runs a tool the way the AI SDK does, with the input the model would send.
const run = (tool: Tool, input: unknown) => tool.execute!(input, { toolCallId: 'call-1', messages: [], context: undefined });

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

test('Read returns the whole file', async () => {
  expect(await run(fileTools(workspace).Read, { file_path: 'notes.md' })).toBe('# Notes\n');
});

test('Read reports a missing file', async () => {
  await expect(run(fileTools(workspace).Read, { file_path: 'nope.md' })).rejects.toThrow('nope.md does not exist');
});

test('Write creates a markdown post, including its folders', async () => {
  expect(await run(fileTools(workspace).Write, { file_path: 'drafts/new.md', content: '# New\n' })).toBe('wrote drafts/new.md');
  expect(await Bun.file(join(workspace, 'drafts/new.md')).text()).toBe('# New\n');
});

test('Write refuses anything that is not a markdown post', async () => {
  const { Write } = fileTools(workspace);
  await expect(run(Write, { file_path: 'script.sh', content: 'x' })).rejects.toThrow('script.sh is not a markdown post');
  await expect(run(Write, { file_path: '.claude/skills/evil/SKILL.md', content: 'x' })).rejects.toThrow(
    '.claude/skills/evil/SKILL.md is not a markdown post',
  );
  expect(await Bun.file(join(workspace, 'script.sh')).exists()).toBe(false);
});

test('Edit replaces text that occurs exactly once', async () => {
  const result = await run(fileTools(workspace).Edit, { file_path: 'notes.md', old_string: 'Notes', new_string: 'Garden' });
  expect(result).toBe('edited notes.md');
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Garden\n');
});

test('Edit refuses text that does not occur', async () => {
  const input = { file_path: 'notes.md', old_string: 'Tomatoes', new_string: 'Beans' };
  await expect(run(fileTools(workspace).Edit, input)).rejects.toThrow('old_string not found in notes.md');
});

test('Edit refuses text that occurs more than once, and leaves the file alone', async () => {
  await writeFile(join(workspace, 'notes.md'), 'a b a b a\n');
  const input = { file_path: 'notes.md', old_string: 'a', new_string: 'z' };
  await expect(run(fileTools(workspace).Edit, input)).rejects.toThrow('old_string appears 3 times in notes.md');
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('a b a b a\n');
});

test('Edit refuses anything that is not a markdown post', async () => {
  await writeFile(join(workspace, 'config.json'), '{"a":1}');
  const input = { file_path: 'config.json', old_string: '1', new_string: '2' };
  await expect(run(fileTools(workspace).Edit, input)).rejects.toThrow('config.json is not a markdown post');
});

test('Glob lists matching files as sorted workspace-relative paths', async () => {
  await mkdir(join(workspace, 'drafts'));
  await writeFile(join(workspace, 'drafts', 'b.md'), '');
  await writeFile(join(workspace, 'drafts', 'a.md'), '');
  await writeFile(join(workspace, 'drafts', 'c.txt'), '');
  expect(await run(fileTools(workspace).Glob, { pattern: '**/*.md' })).toBe('drafts/a.md\ndrafts/b.md\nnotes.md');
});

test('Glob refuses a pattern that reaches outside the workspace', async () => {
  const { Glob } = fileTools(workspace);
  await expect(run(Glob, { pattern: '../*.md' })).rejects.toThrow('../*.md is outside the workspace');
  await expect(run(Glob, { pattern: `${root}/*.md` })).rejects.toThrow(`${root}/*.md is outside the workspace`);
});

test('Glob leaves out matches that lead outside the workspace through a symlink', async () => {
  await mkdir(join(root, 'elsewhere'));
  await writeFile(join(root, 'elsewhere', 'secret.md'), 'secret\n');
  await symlink(join(root, 'elsewhere'), join(workspace, 'escape'));
  expect(await run(fileTools(workspace).Glob, { pattern: 'escape/*.md' })).toBe('');
});

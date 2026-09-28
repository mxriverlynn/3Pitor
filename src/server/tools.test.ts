import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from 'ai';
import { editedTexts, fileTools, postName, resolveInWorkspace, turnTexts } from './tools';
import { APP_SKILL_FILES } from './workspace-config';

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

// The tools for a turn whose browser sent no documents.
const tools = () => fileTools(workspace, turnTexts(workspace, {}));

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

test('names a post the way the documents API does, whatever path or letter case the model used', async () => {
  expect(postName(workspace, './notes.md')).toBe('notes.md');
  expect(postName(workspace, 'drafts/../notes.md')).toBe('notes.md');
  // Only a case-insensitive disk (macOS's default) treats Notes.md as notes.md.
  if (await Bun.file(join(workspace, 'NOTES.MD')).exists()) expect(postName(workspace, 'Notes.md')).toBe('notes.md');
  expect(postName(workspace, 'drafts/new.md')).toBe('drafts/new.md');
});

test('lists edited posts in the order they last changed', async () => {
  await writeFile(join(workspace, 'ideas.md'), '# Ideas\n');
  const turn = turnTexts(workspace, {});
  const { Edit } = fileTools(workspace, turn);

  await run(Edit, { file_path: 'notes.md', old_string: 'Notes', new_string: 'Garden' });
  await run(Edit, { file_path: 'ideas.md', old_string: 'Ideas', new_string: 'Plans' });
  await run(Edit, { file_path: 'notes.md', old_string: 'Garden', new_string: 'Garden Plan' });

  expect(Object.keys(editedTexts(turn))).toEqual(['ideas.md', 'notes.md']);
});

test('Read returns the whole file', async () => {
  expect(await run(tools().Read, { file_path: 'notes.md' })).toBe('# Notes\n');
});

test('Read returns the text the browser sent for a post, over the file on disk', async () => {
  const turn = turnTexts(workspace, { 'notes.md': '# Notes typed but not saved\n' });
  expect(await run(fileTools(workspace, turn).Read, { file_path: 'notes.md' })).toBe('# Notes typed but not saved\n');
});

test('Read reports a missing file', async () => {
  await expect(run(tools().Read, { file_path: 'nope.md' })).rejects.toThrow('nope.md does not exist');
});

test('Read returns an app skill file through the 3pitor://skills/ path', async () => {
  const path = 'collaborative-draft-editing/references/editing-lessons.md';
  expect(await run(tools().Read, { file_path: `3pitor://skills/${path}` })).toBe(APP_SKILL_FILES[path]);
  expect(await run(tools().Read, { file_path: '3pitor://skills/collaborative-draft-editing/./SKILL.md' })).toBe(
    APP_SKILL_FILES['collaborative-draft-editing/SKILL.md'],
  );
});

test('Read reports an unknown app skill file, and one that climbs out of the skills with ..', async () => {
  const { Read } = tools();
  await expect(run(Read, { file_path: '3pitor://skills/nope/SKILL.md' })).rejects.toThrow('3pitor://skills/nope/SKILL.md does not exist');
  await expect(run(Read, { file_path: '3pitor://skills/../x' })).rejects.toThrow('3pitor://skills/../x does not exist');
});

test('Write of a new post creates no file', async () => {
  expect(await run(tools().Write, { file_path: 'drafts/new.md', content: '# New\n' })).toBe('wrote drafts/new.md');
  expect(await Bun.file(join(workspace, 'drafts/new.md')).exists()).toBe(false);
});

test('Write puts the whole post into the turn, as an edited post', async () => {
  const turn = turnTexts(workspace, {});
  await run(fileTools(workspace, turn).Write, { file_path: './drafts/new.md', content: '# New\n' });
  expect(editedTexts(turn)).toEqual({ 'drafts/new.md': '# New\n' });
});

test('Write refuses anything that is not a markdown post', async () => {
  const { Write } = tools();
  await expect(run(Write, { file_path: 'script.sh', content: 'x' })).rejects.toThrow('script.sh is not a markdown post');
  await expect(run(Write, { file_path: '.claude/skills/evil/SKILL.md', content: 'x' })).rejects.toThrow(
    '.claude/skills/evil/SKILL.md is not a markdown post',
  );
  expect(await Bun.file(join(workspace, 'script.sh')).exists()).toBe(false);
});

test('Write and Edit refuse an app skill file, which is read-only', async () => {
  const { Write, Edit } = tools();
  const file_path = '3pitor://skills/collaborative-draft-editing/SKILL.md';
  await expect(run(Write, { file_path, content: 'x' })).rejects.toThrow(`${file_path} is not a markdown post`);
  await expect(run(Edit, { file_path, old_string: 'name', new_string: 'x' })).rejects.toThrow(`${file_path} is not a markdown post`);
});

test('Edit replaces text that occurs exactly once, in the turn and not on disk', async () => {
  const turn = turnTexts(workspace, {});
  const result = await run(fileTools(workspace, turn).Edit, { file_path: 'notes.md', old_string: 'Notes', new_string: 'Garden' });
  expect(result).toBe('edited notes.md');
  expect(editedTexts(turn)).toEqual({ 'notes.md': '# Garden\n' });
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Notes\n');
});

test('Edit changes the text the browser sent, and a later Edit sees the change', async () => {
  const turn = turnTexts(workspace, { 'notes.md': '# Notes typed\n' });
  const { Edit } = fileTools(workspace, turn);

  await run(Edit, { file_path: 'notes.md', old_string: 'typed', new_string: 'kept' });
  await run(Edit, { file_path: './notes.md', old_string: 'kept', new_string: 'kept twice' });

  expect(editedTexts(turn)).toEqual({ 'notes.md': '# Notes kept twice\n' });
});

test('Edit refuses text that does not occur', async () => {
  const input = { file_path: 'notes.md', old_string: 'Tomatoes', new_string: 'Beans' };
  await expect(run(tools().Edit, input)).rejects.toThrow('old_string not found in notes.md');
});

test('Edit refuses text that occurs more than once, and leaves the file alone', async () => {
  await writeFile(join(workspace, 'notes.md'), 'a b a b a\n');
  const input = { file_path: 'notes.md', old_string: 'a', new_string: 'z' };
  await expect(run(tools().Edit, input)).rejects.toThrow('old_string appears 3 times in notes.md');
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('a b a b a\n');
});

test('Edit and Write refuse a post with markdown the editor cannot keep', async () => {
  await writeFile(join(workspace, 'plan.md'), '# Plan\n\n| a | b |\n| - | - |\n| 1 | 2 |\n');
  const turn = turnTexts(workspace, {});
  const { Edit, Write } = fileTools(workspace, turn);
  const refusal = "plan.md has tables, which the editor can't keep, so it can't be edited here";

  await expect(run(Edit, { file_path: 'plan.md', old_string: 'Plan', new_string: 'Garden' })).rejects.toThrow(refusal);
  await expect(run(Write, { file_path: 'plan.md', content: '# Garden\n' })).rejects.toThrow(refusal);
  expect(editedTexts(turn)).toEqual({});
});

test('Edit and Write refuse to add markdown the editor cannot keep', async () => {
  const turn = turnTexts(workspace, {});
  const { Edit, Write } = fileTools(workspace, turn);

  await expect(run(Edit, { file_path: 'notes.md', old_string: 'Notes', new_string: 'Notes\n\n<div>hi</div>' })).rejects.toThrow(
    "the edit would add raw HTML to notes.md, which the editor can't keep",
  );
  await expect(run(Write, { file_path: 'new.md', content: '- [ ] water\n' })).rejects.toThrow(
    "the edit would add task lists to new.md, which the editor can't keep",
  );
  expect(editedTexts(turn)).toEqual({});
});

test('Edit refuses anything that is not a markdown post', async () => {
  await writeFile(join(workspace, 'config.json'), '{"a":1}');
  const input = { file_path: 'config.json', old_string: '1', new_string: '2' };
  await expect(run(tools().Edit, input)).rejects.toThrow('config.json is not a markdown post');
});

test('Glob lists matching files as sorted workspace-relative paths', async () => {
  await mkdir(join(workspace, 'drafts'));
  await writeFile(join(workspace, 'drafts', 'b.md'), '');
  await writeFile(join(workspace, 'drafts', 'a.md'), '');
  await writeFile(join(workspace, 'drafts', 'c.txt'), '');
  expect(await run(tools().Glob, { pattern: '**/*.md' })).toBe('drafts/a.md\ndrafts/b.md\nnotes.md');
});

test('Glob refuses a pattern that reaches outside the workspace', async () => {
  const { Glob } = tools();
  await expect(run(Glob, { pattern: '../*.md' })).rejects.toThrow('../*.md is outside the workspace');
  await expect(run(Glob, { pattern: `${root}/*.md` })).rejects.toThrow(`${root}/*.md is outside the workspace`);
});

test('Glob leaves out matches that lead outside the workspace through a symlink', async () => {
  await mkdir(join(root, 'elsewhere'));
  await writeFile(join(root, 'elsewhere', 'secret.md'), 'secret\n');
  await symlink(join(root, 'elsewhere'), join(workspace, 'escape'));
  expect(await run(tools().Glob, { pattern: 'escape/*.md' })).toBe('');
});

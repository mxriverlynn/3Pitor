import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from 'ai';
import type { z } from 'zod';
import { editedTexts, fileTools, postBlocks, postName, turnTexts } from './tools';
import { APP_SKILL_FILES } from '../../workspace-config/workspace-config';

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
  const path = 'collaborative-editing/references/editing-lessons.md';
  expect(await run(tools().Read, { file_path: `3pitor://skills/${path}` })).toBe(APP_SKILL_FILES[path]);
  expect(await run(tools().Read, { file_path: '3pitor://skills/collaborative-editing/./SKILL.md' })).toBe(
    APP_SKILL_FILES['collaborative-editing/SKILL.md'],
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

// A note: markdown under .3pitor/, which the server writes to disk and keeps out of the editor.
const NOTE = '.3pitor/editing/2026-10-01-garden-content-edit.md';

test('Write saves a note under .3pitor/ to disk, and leaves it out of the turn', async () => {
  const turn = turnTexts(workspace, {});
  let changes = 0;
  const { Write } = fileTools(workspace, turn, () => changes++);

  expect(await run(Write, { file_path: NOTE, content: '# Log\n' })).toBe(`wrote ${NOTE}`);

  expect(await Bun.file(join(workspace, NOTE)).text()).toBe('# Log\n');
  expect(editedTexts(turn)).toEqual({});
  expect(turn.highlights).toBeUndefined();
  expect(changes).toBe(0);
});

test('Edit changes a note on disk, and leaves it out of the turn', async () => {
  await mkdir(join(workspace, '.3pitor/editing'), { recursive: true });
  await writeFile(join(workspace, NOTE), '# Log\n\n## Feedback log\n');
  const turn = turnTexts(workspace, {});
  let changes = 0;
  const { Edit } = fileTools(workspace, turn, () => changes++);

  const result = await run(Edit, { file_path: NOTE, old_string: '## Feedback log\n', new_string: '## Feedback log\n\n- cut the aside\n' });

  expect(result).toBe(`edited ${NOTE}`);
  expect(await Bun.file(join(workspace, NOTE)).text()).toBe('# Log\n\n## Feedback log\n\n- cut the aside\n');
  expect(editedTexts(turn)).toEqual({});
  expect(turn.highlights).toBeUndefined();
  expect(changes).toBe(0);
});

test('Edit refuses a note that does not exist, and text that does not occur exactly once in it', async () => {
  const { Edit } = tools();
  await expect(run(Edit, { file_path: NOTE, old_string: 'a', new_string: 'z' })).rejects.toThrow(`${NOTE} does not exist`);
  await mkdir(join(workspace, '.3pitor/editing'), { recursive: true });
  await writeFile(join(workspace, NOTE), 'a b a\n');
  await expect(run(Edit, { file_path: NOTE, old_string: 'c', new_string: 'z' })).rejects.toThrow(`old_string not found in ${NOTE}`);
  await expect(run(Edit, { file_path: NOTE, old_string: 'a', new_string: 'z' })).rejects.toThrow(`old_string appears 2 times in ${NOTE}`);
  expect(await Bun.file(join(workspace, NOTE)).text()).toBe('a b a\n');
});

test('Read returns a note Write saved', async () => {
  const { Read, Write } = tools();
  await run(Write, { file_path: NOTE, content: '# Log\n' });
  expect(await run(Read, { file_path: NOTE })).toBe('# Log\n');
});

test('Write still refuses the app\'s own files under .3pitor/, and markdown in a dot-folder inside it', async () => {
  const { Write } = tools();
  for (const file_path of ['.3pitor/session.json', '.3pitor/editing/.x.md', '.3pitor/.a/b.md']) {
    await expect(run(Write, { file_path, content: 'x' })).rejects.toThrow(`${file_path} is not a markdown post`);
    expect(await Bun.file(join(workspace, file_path)).exists()).toBe(false);
  }
});

test('Write treats a path that climbs out of .3pitor/ as the post it lands on', async () => {
  const turn = turnTexts(workspace, {});
  expect(await run(fileTools(workspace, turn).Write, { file_path: '.3pitor/../notes.md', content: '# Garden\n' })).toBe('wrote notes.md');
  expect(editedTexts(turn)).toEqual({ 'notes.md': '# Garden\n' });
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Notes\n');
});

test('Highlight refuses a note, which is never in the editor', async () => {
  const { Write, Highlight } = tools();
  await run(Write, { file_path: NOTE, content: '# Log\n' });
  await expect(run(Highlight, { file_path: NOTE, passages: [{ quote: 'Log' }] })).rejects.toThrow(`${NOTE} is not a markdown post`);
});

test('Write and Edit refuse an app skill file, which is read-only', async () => {
  const { Write, Edit } = tools();
  const file_path = '3pitor://skills/collaborative-editing/SKILL.md';
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
  await expect(run(Write, { file_path: 'new.md', content: '| a | b |\n| - | - |\n' })).rejects.toThrow(
    "the edit would add tables to new.md, which the editor can't keep",
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

// A post with a heading, a soft-wrapped paragraph with emphasis, and a list.
const DRAFT = '# Garden\n\nMost gardeners *never* test\ntheir soil, as I said earlier.\n\n- the soil\n- the seeds\n';

test('Highlight names passages in a post for the writer, replacing the turn’s earlier ones', async () => {
  await writeFile(join(workspace, 'draft.md'), DRAFT);
  const turn = turnTexts(workspace, {});
  const { Highlight } = fileTools(workspace, turn);
  await run(Highlight, { file_path: 'draft.md', passages: [{ quote: 'the seeds' }] });
  const passages = [{ quote: 'Most gardeners never test their soil', label: 'Q1' }, { quote: 'as I said earlier', label: 'Q2' }];
  expect(await run(Highlight, { file_path: './draft.md', passages })).toBe('highlighted 2 passages in draft.md');
  expect(turn.highlights).toEqual({ file: 'draft.md', passages });
});

test('Edit highlights the text it put in the post', async () => {
  await writeFile(join(workspace, 'draft.md'), DRAFT);
  const turn = turnTexts(workspace, {});
  const { Edit } = fileTools(workspace, turn);

  await run(Edit, { file_path: 'draft.md', old_string: '*never* test', new_string: '*rarely* test' });

  expect(turn.highlights).toEqual({ file: 'draft.md', passages: [{ quote: 'rarely test' }] });
});

test('each Edit adds its text to the highlights, which drop a passage a later edit changed', async () => {
  await writeFile(join(workspace, 'draft.md'), DRAFT);
  const turn = turnTexts(workspace, {});
  const { Edit } = fileTools(workspace, turn);

  await run(Edit, { file_path: 'draft.md', old_string: 'the soil', new_string: 'the loam' });
  await run(Edit, { file_path: 'draft.md', old_string: 'the seeds', new_string: 'the seedlings' });
  await run(Edit, { file_path: 'draft.md', old_string: 'the loam', new_string: 'the clay' });

  expect(turn.highlights).toEqual({ file: 'draft.md', passages: [{ quote: 'the seedlings' }, { quote: 'the clay' }] });
});

test('Write highlights each paragraph, heading, or list item it changed', async () => {
  await writeFile(join(workspace, 'draft.md'), DRAFT);
  const turn = turnTexts(workspace, {});
  const { Write } = fileTools(workspace, turn);

  await run(Write, { file_path: 'draft.md', content: DRAFT.replace('Garden', 'Yard').replace('the seeds', 'the seedlings') });

  expect(turn.highlights).toEqual({ file: 'draft.md', passages: [{ quote: 'Yard' }, { quote: 'the seedlings' }] });
});

test('Highlight with no passages clears the post’s highlights', async () => {
  await writeFile(join(workspace, 'draft.md'), DRAFT);
  const turn = turnTexts(workspace, {});
  const { Highlight } = fileTools(workspace, turn);
  await run(Highlight, { file_path: 'draft.md', passages: [{ quote: 'the seeds', label: 'Q1' }] });

  const input = (Highlight.inputSchema as z.ZodType).parse({ file_path: 'draft.md', passages: [] });
  expect(await run(Highlight, input)).toBe('cleared the highlights in draft.md');

  expect(turn.highlights).toEqual({ file: 'draft.md', passages: [] });
});

test('Highlight takes the question asked about each passage and keeps it with the passage', async () => {
  await writeFile(join(workspace, 'draft.md'), DRAFT);
  const turn = turnTexts(workspace, {});
  const { Highlight } = fileTools(workspace, turn);
  const passages = [{ quote: 'as I said earlier', label: 'Q1', question: "Is this aside worth keeping? I'd cut it." }];
  const input = (Highlight.inputSchema as z.ZodType).parse({ file_path: 'draft.md', passages });
  await run(Highlight, input);
  expect(turn.highlights).toEqual({ file: 'draft.md', passages });
  expect(Highlight.description).toContain('put the question you ask about it in `question`');
});

test('Highlight refuses a quote that is not in the post, and keeps the earlier passages', async () => {
  await writeFile(join(workspace, 'draft.md'), DRAFT);
  const turn = turnTexts(workspace, {});
  const { Highlight } = fileTools(workspace, turn);
  await run(Highlight, { file_path: 'draft.md', passages: [{ quote: 'the seeds' }] });
  await expect(run(Highlight, { file_path: 'draft.md', passages: [{ quote: 'as I said later' }] })).rejects.toThrow(
    '"as I said later" is not in draft.md',
  );
  await expect(run(Highlight, { file_path: 'draft.md', passages: [{ quote: 'Garden Most' }] })).rejects.toThrow(
    '"Garden Most" is not in draft.md',
  );
  expect(turn.highlights).toEqual({ file: 'draft.md', passages: [{ quote: 'the seeds' }] });
});

test('Highlight refuses a quote that appears more than once', async () => {
  await writeFile(join(workspace, 'draft.md'), DRAFT);
  await expect(run(tools().Highlight, { file_path: 'draft.md', passages: [{ quote: 'the s' }] })).rejects.toThrow(
    '"the s" appears 2 times in draft.md; quote more of it',
  );
});

test('Highlight refuses two passages with the same label', async () => {
  await writeFile(join(workspace, 'draft.md'), DRAFT);
  const passages = [{ quote: 'the soil', label: 'Q1' }, { quote: 'the seeds', label: 'Q1' }];
  await expect(run(tools().Highlight, { file_path: 'draft.md', passages })).rejects.toThrow('label "Q1" is used twice');
});

test('Highlight checks a post edited earlier in the turn against its edited text', async () => {
  await writeFile(join(workspace, 'draft.md'), DRAFT);
  const { Edit, Highlight } = tools();
  await run(Edit, { file_path: 'draft.md', old_string: 'as I said earlier', new_string: 'as tests show' });
  expect(await run(Highlight, { file_path: 'draft.md', passages: [{ quote: 'as tests show' }] })).toBe('highlighted 1 passages in draft.md');
  await expect(run(Highlight, { file_path: 'draft.md', passages: [{ quote: 'as I said earlier' }] })).rejects.toThrow('is not in draft.md');
});

// The editor's test (markdown-editor.test.tsx) expects the same five blocks from the same post, so a quote
// Highlight accepts is one the editor finds.
test('splits a post into the blocks the editor shows: headings, paragraphs, list items and code blocks', () => {
  const md =
    '# Garden *Plan*\n\nMost gardeners **never** test\ntheir [soil](https://example.com) with `pH` strips.\n\n- beans\n- the *tomatoes*\n\n```\nwater();\n```\n';
  expect(postBlocks(md)).toEqual(['Garden Plan', 'Most gardeners never test their soil with pH strips.', 'beans', 'the tomatoes', 'water();']);
});

test('postBlocks leaves the boxes out of task list items, as the editor does', () => {
  expect(postBlocks('- [ ] sow the beans\n- [x] till the bed\n')).toEqual(['sow the beans', 'till the bed']);
});

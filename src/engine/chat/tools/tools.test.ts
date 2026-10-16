import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from 'ai';
import type { z } from 'zod';
import { createLocalFileSystem, type FileSystem } from '../../../file-system/file-system';
import { createFilePostStore, type PostStore } from '../../../posts/posts';
import { editedTexts, fileTools, postBlocks, turnTexts } from './tools';
import { APP_SKILL_FILES } from '../../../app-files/app-files';

let root: string;
let workspace: string;
let fileSystem: FileSystem;
let posts: PostStore;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), '3pitor-tools-')));
  workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'notes.md'), '# Notes\n');
  fileSystem = createLocalFileSystem(workspace);
  posts = createFilePostStore(fileSystem);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// Makes the post "notes", beside the loose notes.md, which is a workspace file and not a post.
const notesPost = () => posts.create({ title: 'notes', body: '# Notes\n' });

// The tools for a turn whose browser sent no documents.
const tools = () => fileTools(fileSystem, posts, APP_SKILL_FILES, turnTexts({}));

// Runs a tool the way the AI SDK does, with the input the model would send.
const run = (tool: Tool, input: unknown) => tool.execute!(input, { toolCallId: 'call-1', messages: [], context: undefined });

test('Read returns a post by its id, from the store when the turn holds nothing for it', async () => {
  const id = await posts.create({ title: 'The Sun', body: 'It rises.' });
  expect(await run(fileTools(fileSystem, posts, {}, turnTexts({})).Read, { file_path: id })).toBe('It rises.');
});

test('Read returns the text the browser sent for a post id, over the stored body', async () => {
  const id = await posts.create({ title: 'The Sun', body: 'It rises.' });
  const turn = turnTexts({ [id]: 'It rises, unsaved.' });
  expect(await run(fileTools(fileSystem, posts, {}, turn).Read, { file_path: id })).toBe('It rises, unsaved.');
});

test('Read passes on a store failure rather than reading around it', async () => {
  const broken = { ...posts, get: () => Promise.reject(new Error('store down')) };
  await expect(run(fileTools(fileSystem, broken, {}, turnTexts({})).Read, { file_path: 'notes.md' })).rejects.toThrow('store down');
});

test('Edit, Write, and Highlight change a post named by its id in the turn’s copy, keyed by that id', async () => {
  const id = await posts.create({ title: 'The Sun', body: 'It rises.\n' });
  const turn = turnTexts({});
  const { Edit, Write, Highlight } = fileTools(fileSystem, posts, {}, turn);
  expect(await run(Edit, { file_path: id, old_string: 'rises', new_string: 'sets' })).toBe(`edited ${id}`);
  expect(editedTexts(turn)).toEqual({ [id]: 'It sets.\n' });
  expect(await run(Write, { file_path: id, content: 'It rises again.\n' })).toBe(`wrote ${id}`);
  expect(await run(Highlight, { file_path: id, passages: [{ quote: 'again' }] })).toBe(`highlighted 1 passages in ${id}`);
  expect([editedTexts(turn), turn.highlights]).toEqual([{ [id]: 'It rises again.\n' }, { file: id, passages: [{ quote: 'again' }] }]);
  expect((await posts.get(id)).body).toBe('It rises.\n');
});

test('Posts lists every post’s id and title, by title and then by id', async () => {
  const sun = await posts.create({ title: 'The Sun', body: '' });
  const again = await posts.create({ title: 'The Sun', body: '' });
  const moon = await posts.create({ title: 'Moon', body: '' });
  const listed = JSON.parse(String(await run(tools().Posts, {})));
  expect(listed).toEqual([{ id: moon, title: 'Moon' }, { id: sun, title: 'The Sun' }, { id: again, title: 'The Sun' }]);
});

// The post exists, empty, the moment NewPost runs; its text reaches the store only through the writer's Save.
test('NewPost makes an empty post with the title, and puts the text in the editor as an unsaved edit of its id', async () => {
  const turn = turnTexts({});
  const result = await run(fileTools(fileSystem, posts, {}, turn).NewPost, { title: 'The Sun', content: '# The Sun\n\nIt rises.\n' });

  const { posts: listed } = await posts.list();
  expect(listed).toEqual([{ id: 'The Sun', title: 'The Sun' }]);
  expect(result).toBe('made post "The Sun" titled "The Sun"; its text is in the editor, unsaved');
  expect((await posts.get('The Sun')).body).toBe('');
  expect(editedTexts(turn)).toEqual({ 'The Sun': '# The Sun\n\nIt rises.\n' });
  expect(turn.highlights?.file).toBe('The Sun');
});

test('NewPost answers a blank title with the store’s sentence, and makes nothing for text the editor cannot keep', async () => {
  const { NewPost } = fileTools(fileSystem, posts, {}, turnTexts({}));
  expect(await run(NewPost, { title: ' ', content: 'Hi.' })).toBe('A post needs a title.');
  await expect(run(NewPost, { title: 'Tables', content: '<div>hi</div>\n' })).rejects.toThrow("which the editor can't keep");
  expect(await posts.list()).toEqual({ posts: [] });
});

test('two NewPost calls with one title make two posts, each edit under its own id', async () => {
  const turn = turnTexts({});
  const { NewPost } = fileTools(fileSystem, posts, {}, turn);
  await run(NewPost, { title: 'Notes', content: 'One.' });
  await run(NewPost, { title: 'Notes', content: 'Two.' });
  expect(editedTexts(turn)).toEqual({ Notes: 'One.', 'Notes 2': 'Two.' });
});

// A draft path is not a post's id, and a loose .md file is not a post: the AI may read them but change only posts.
test('Write, Edit, and Highlight refuse a path that is not a post id, pointing to Posts and NewPost', async () => {
  const id = await posts.create({ title: 'the sun', body: 'It rises.\n' });
  const { Write, Edit, Highlight } = fileTools(fileSystem, posts, {}, turnTexts({}));
  for (const file_path of [`${id}/draft.md`, 'notes.md', 'editing-lessons.md']) {
    const refusal = `${file_path} is not a post. Call Posts to list the posts by id, or NewPost to make one.`;
    await expect(run(Write, { file_path, content: 'x' })).rejects.toThrow(refusal);
    await expect(run(Edit, { file_path, old_string: 'Notes', new_string: 'x' })).rejects.toThrow(refusal);
    await expect(run(Highlight, { file_path, passages: [] })).rejects.toThrow(refusal);
  }
});


test('lists edited posts in the order they last changed', async () => {
  await notesPost();
  await posts.create({ title: 'ideas', body: '# Ideas\n' });
  const turn = turnTexts({});
  const { Edit } = fileTools(fileSystem, posts, {}, turn);

  await run(Edit, { file_path: 'notes', old_string: 'Notes', new_string: 'Garden' });
  await run(Edit, { file_path: 'ideas', old_string: 'Ideas', new_string: 'Plans' });
  await run(Edit, { file_path: 'notes', old_string: 'Garden', new_string: 'Garden Plan' });

  expect(Object.keys(editedTexts(turn))).toEqual(['ideas', 'notes']);
});

test('Read returns the whole file', async () => {
  expect(await run(tools().Read, { file_path: 'notes.md' })).toBe('# Notes\n');
});

test('Read returns the text the browser sent for a post, over the file on disk', async () => {
  const turn = turnTexts({ 'notes.md': '# Notes typed but not saved\n' });
  expect(await run(fileTools(fileSystem, posts, {}, turn).Read, { file_path: 'notes.md' })).toBe('# Notes typed but not saved\n');
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


test('Write puts the whole post into the turn, as an edited post', async () => {
  await notesPost();
  const turn = turnTexts({});
  await run(fileTools(fileSystem, posts, {}, turn).Write, { file_path: 'notes', content: '# New\n' });
  expect(editedTexts(turn)).toEqual({ notes: '# New\n' });
  expect((await posts.get('notes')).body).toBe('# Notes\n');
});

test('Write refuses anything that is not a post', async () => {
  const { Write } = tools();
  await expect(run(Write, { file_path: 'script.sh', content: 'x' })).rejects.toThrow('script.sh is not a post');
  await expect(run(Write, { file_path: '.claude/skills/evil/SKILL.md', content: 'x' })).rejects.toThrow(
    '.claude/skills/evil/SKILL.md is not a post',
  );
  expect(await Bun.file(join(workspace, 'script.sh')).exists()).toBe(false);
});

// A note: markdown under .3pitor/, which the server writes to disk and keeps out of the editor.
const NOTE = '.3pitor/editing/2026-10-01-garden-content-edit.md';

test('Write saves a note under .3pitor/ to disk, and leaves it out of the turn', async () => {
  const turn = turnTexts({});
  let changes = 0;
  const { Write } = fileTools(fileSystem, posts, {}, turn, () => changes++);

  expect(await run(Write, { file_path: NOTE, content: '# Log\n' })).toBe(`wrote ${NOTE}`);

  expect(await Bun.file(join(workspace, NOTE)).text()).toBe('# Log\n');
  expect(editedTexts(turn)).toEqual({});
  expect(turn.highlights).toBeUndefined();
  expect(changes).toBe(0);
});

test('Edit changes a note on disk, and leaves it out of the turn', async () => {
  await mkdir(join(workspace, '.3pitor/editing'), { recursive: true });
  await writeFile(join(workspace, NOTE), '# Log\n\n## Feedback log\n');
  const turn = turnTexts({});
  let changes = 0;
  const { Edit } = fileTools(fileSystem, posts, {}, turn, () => changes++);

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
    await expect(run(Write, { file_path, content: 'x' })).rejects.toThrow(`${file_path} is not a post`);
    expect(await Bun.file(join(workspace, file_path)).exists()).toBe(false);
  }
});

test('Write refuses a path that climbs out of .3pitor/, which is no note and no post id', async () => {
  await notesPost();
  const turn = turnTexts({});
  await expect(run(fileTools(fileSystem, posts, {}, turn).Write, { file_path: '.3pitor/../notes', content: '# Garden\n' })).rejects.toThrow(
    '.3pitor/../notes is not a post',
  );
  expect(editedTexts(turn)).toEqual({});
  expect((await posts.get('notes')).body).toBe('# Notes\n');
});


test('Highlight refuses a note, which is never in the editor', async () => {
  const { Write, Highlight } = tools();
  await run(Write, { file_path: NOTE, content: '# Log\n' });
  await expect(run(Highlight, { file_path: NOTE, passages: [{ quote: 'Log' }] })).rejects.toThrow(`${NOTE} is not a post`);
});

test('Write and Edit tell the model a markdown file under .3pitor/ is saved directly and never opens in the editor', () => {
  const { Write, Edit } = tools();
  for (const { description } of [Write, Edit]) {
    expect(description).toContain('A markdown file under .3pitor/ is saved directly and never opens in the editor.');
  }
});

test('Write and Edit refuse an app skill file, which is read-only', async () => {
  const { Write, Edit } = tools();
  const file_path = '3pitor://skills/collaborative-editing/SKILL.md';
  await expect(run(Write, { file_path, content: 'x' })).rejects.toThrow(`${file_path} is not a post`);
  await expect(run(Edit, { file_path, old_string: 'name', new_string: 'x' })).rejects.toThrow(`${file_path} is not a post`);
});

test('Edit replaces text that occurs exactly once, in the turn and not on disk', async () => {
  await notesPost();
  const turn = turnTexts({});
  const result = await run(fileTools(fileSystem, posts, {}, turn).Edit, { file_path: 'notes', old_string: 'Notes', new_string: 'Garden' });
  expect(result).toBe('edited notes');
  expect(editedTexts(turn)).toEqual({ notes: '# Garden\n' });
  expect((await posts.get('notes')).body).toBe('# Notes\n');
});

test('Edit changes the text the browser sent, and a later Edit sees the change', async () => {
  await notesPost();
  const turn = turnTexts({ notes: '# Notes typed\n' });
  const { Edit } = fileTools(fileSystem, posts, {}, turn);

  await run(Edit, { file_path: 'notes', old_string: 'typed', new_string: 'kept' });
  await run(Edit, { file_path: 'notes', old_string: 'kept', new_string: 'kept twice' });

  expect(editedTexts(turn)).toEqual({ notes: '# Notes kept twice\n' });
});

test('Edit refuses text that does not occur', async () => {
  await notesPost();
  const input = { file_path: 'notes', old_string: 'Tomatoes', new_string: 'Beans' };
  await expect(run(tools().Edit, input)).rejects.toThrow('old_string not found in notes');
});

test('Edit refuses text that occurs more than once, and leaves the file alone', async () => {
  await posts.create({ title: 'notes', body: 'a b a b a\n' });
  const input = { file_path: 'notes', old_string: 'a', new_string: 'z' };
  await expect(run(tools().Edit, input)).rejects.toThrow('old_string appears 3 times in notes');
  expect((await posts.get('notes')).body).toBe('a b a b a\n');
});

test('Edit and Write refuse a post with markdown the editor cannot keep', async () => {
  await notesPost();
  await posts.create({ title: 'plan', body: '# Plan\n\n<div>hi</div>\n' });
  const turn = turnTexts({});
  const { Edit, Write } = fileTools(fileSystem, posts, {}, turn);
  const refusal = "plan has raw HTML, which the editor can't keep, so it can't be edited here";

  await expect(run(Edit, { file_path: 'plan', old_string: 'Plan', new_string: 'Garden' })).rejects.toThrow(refusal);
  await expect(run(Write, { file_path: 'plan', content: '# Garden\n' })).rejects.toThrow(refusal);
  expect(editedTexts(turn)).toEqual({});
});

test('Edit and Write refuse to add markdown the editor cannot keep', async () => {
  await notesPost();
  await posts.create({ title: 'new', body: '' });
  const turn = turnTexts({});
  const { Edit, Write } = fileTools(fileSystem, posts, {}, turn);

  await expect(run(Edit, { file_path: 'notes', old_string: 'Notes', new_string: 'Notes\n\n<div>hi</div>' })).rejects.toThrow(
    "the edit would add raw HTML to notes, which the editor can't keep",
  );
  await expect(run(Write, { file_path: 'new', content: '<div>hi</div>\n' })).rejects.toThrow(
    "the edit would add raw HTML to new, which the editor can't keep",
  );
  expect(editedTexts(turn)).toEqual({});
});

test('Edit and Write keep a post with a table', async () => {
  await notesPost();
  await posts.create({ title: 'plan', body: '# Plan\n\n| crop | bed |\n| --- | --- |\n| beans | north |\n' });
  await posts.create({ title: 'new', body: '' });
  const turn = turnTexts({});
  const { Edit, Write } = fileTools(fileSystem, posts, {}, turn);

  await run(Edit, { file_path: 'plan', old_string: 'beans', new_string: 'kale' });
  await run(Write, { file_path: 'new', content: '| a | b |\n| - | - |\n' });

  expect(editedTexts(turn)).toEqual({
    'plan': '# Plan\n\n| crop | bed |\n| --- | --- |\n| kale | north |\n',
    'new': '| a | b |\n| - | - |\n',
  });
});

test('Edit refuses anything that is not a post', async () => {
  await writeFile(join(workspace, 'config.json'), '{"a":1}');
  const input = { file_path: 'config.json', old_string: '1', new_string: '2' };
  await expect(run(tools().Edit, input)).rejects.toThrow('config.json is not a post');
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
  await notesPost();
  await posts.create({ title: 'draft', body: DRAFT });
  const turn = turnTexts({});
  const { Highlight } = fileTools(fileSystem, posts, {}, turn);
  await run(Highlight, { file_path: 'draft', passages: [{ quote: 'the seeds' }] });
  const passages = [{ quote: 'Most gardeners never test their soil', label: 'Q1' }, { quote: 'as I said earlier', label: 'Q2' }];
  expect(await run(Highlight, { file_path: 'draft', passages })).toBe('highlighted 2 passages in draft');
  expect(turn.highlights).toEqual({ file: 'draft', passages });
});

test('Edit highlights the text it put in the post', async () => {
  await notesPost();
  await posts.create({ title: 'draft', body: DRAFT });
  const turn = turnTexts({});
  const { Edit } = fileTools(fileSystem, posts, {}, turn);

  await run(Edit, { file_path: 'draft', old_string: '*never* test', new_string: '*rarely* test' });

  expect(turn.highlights).toEqual({ file: 'draft', passages: [{ quote: 'rarely test' }] });
});

test('each Edit adds its text to the highlights, which drop a passage a later edit changed', async () => {
  await notesPost();
  await posts.create({ title: 'draft', body: DRAFT });
  const turn = turnTexts({});
  const { Edit } = fileTools(fileSystem, posts, {}, turn);

  await run(Edit, { file_path: 'draft', old_string: 'the soil', new_string: 'the loam' });
  await run(Edit, { file_path: 'draft', old_string: 'the seeds', new_string: 'the seedlings' });
  await run(Edit, { file_path: 'draft', old_string: 'the loam', new_string: 'the clay' });

  expect(turn.highlights).toEqual({ file: 'draft', passages: [{ quote: 'the seedlings' }, { quote: 'the clay' }] });
});

test('Write highlights each paragraph, heading, or list item it changed', async () => {
  await notesPost();
  await posts.create({ title: 'draft', body: DRAFT });
  const turn = turnTexts({});
  const { Write } = fileTools(fileSystem, posts, {}, turn);

  await run(Write, { file_path: 'draft', content: DRAFT.replace('Garden', 'Yard').replace('the seeds', 'the seedlings') });

  expect(turn.highlights).toEqual({ file: 'draft', passages: [{ quote: 'Yard' }, { quote: 'the seedlings' }] });
});

test('Highlight with no passages clears the post’s highlights', async () => {
  await notesPost();
  await posts.create({ title: 'draft', body: DRAFT });
  const turn = turnTexts({});
  const { Highlight } = fileTools(fileSystem, posts, {}, turn);
  await run(Highlight, { file_path: 'draft', passages: [{ quote: 'the seeds', label: 'Q1' }] });

  const input = (Highlight.inputSchema as z.ZodType).parse({ file_path: 'draft', passages: [] });
  expect(await run(Highlight, input)).toBe('cleared the highlights in draft');

  expect(turn.highlights).toEqual({ file: 'draft', passages: [] });
});

test('Highlight takes the question asked about each passage and keeps it with the passage', async () => {
  await notesPost();
  await posts.create({ title: 'draft', body: DRAFT });
  const turn = turnTexts({});
  const { Highlight } = fileTools(fileSystem, posts, {}, turn);
  const passages = [{ quote: 'as I said earlier', label: 'Q1', question: "Is this aside worth keeping? I'd cut it." }];
  const input = (Highlight.inputSchema as z.ZodType).parse({ file_path: 'draft', passages });
  await run(Highlight, input);
  expect(turn.highlights).toEqual({ file: 'draft', passages });
  expect(Highlight.description).toContain('put the question you ask about it in `question`');
});

test('Highlight refuses a quote that is not in the post, and keeps the earlier passages', async () => {
  await notesPost();
  await posts.create({ title: 'draft', body: DRAFT });
  const turn = turnTexts({});
  const { Highlight } = fileTools(fileSystem, posts, {}, turn);
  await run(Highlight, { file_path: 'draft', passages: [{ quote: 'the seeds' }] });
  await expect(run(Highlight, { file_path: 'draft', passages: [{ quote: 'as I said later' }] })).rejects.toThrow(
    '"as I said later" is not in draft',
  );
  await expect(run(Highlight, { file_path: 'draft', passages: [{ quote: 'Garden Most' }] })).rejects.toThrow(
    '"Garden Most" is not in draft',
  );
  expect(turn.highlights).toEqual({ file: 'draft', passages: [{ quote: 'the seeds' }] });
});

test('Highlight refuses a quote that appears more than once', async () => {
  await notesPost();
  await posts.create({ title: 'draft', body: DRAFT });
  await expect(run(tools().Highlight, { file_path: 'draft', passages: [{ quote: 'the s' }] })).rejects.toThrow(
    '"the s" appears 2 times in draft; quote more of it',
  );
});

test('Highlight refuses two passages with the same label', async () => {
  await writeFile(join(workspace, 'draft.md'), DRAFT);
  const passages = [{ quote: 'the soil', label: 'Q1' }, { quote: 'the seeds', label: 'Q1' }];
  await expect(run(tools().Highlight, { file_path: 'draft.md', passages })).rejects.toThrow('label "Q1" is used twice');
});

test('Highlight checks a post edited earlier in the turn against its edited text', async () => {
  await notesPost();
  await posts.create({ title: 'draft', body: DRAFT });
  const { Edit, Highlight } = tools();
  await run(Edit, { file_path: 'draft', old_string: 'as I said earlier', new_string: 'as tests show' });
  expect(await run(Highlight, { file_path: 'draft', passages: [{ quote: 'as tests show' }] })).toBe('highlighted 1 passages in draft');
  await expect(run(Highlight, { file_path: 'draft', passages: [{ quote: 'as I said earlier' }] })).rejects.toThrow('is not in draft');
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

test('Edit reports a missing post by its id', async () => {
  await expect(run(tools().Edit, { file_path: 'nope', old_string: 'a', new_string: 'b' })).rejects.toThrow('nope is not a post');
});


test('Read refuses a path through a symlinked folder, even one inside the workspace', async () => {
  await mkdir(join(workspace, 'drafts'));
  await writeFile(join(workspace, 'drafts', 'a.md'), 'a');
  await symlink(join(workspace, 'drafts'), join(workspace, 'shortcut'));
  await expect(run(tools().Read, { file_path: 'shortcut/a.md' })).rejects.toThrow('shortcut/a.md is outside the workspace');
});

test('Read refuses a file that is a symlink', async () => {
  await symlink(join(workspace, 'notes.md'), join(workspace, 'link.md'));
  await expect(run(tools().Read, { file_path: 'link.md' })).rejects.toThrow('link.md is a symlink');
});

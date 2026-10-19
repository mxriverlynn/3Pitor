import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFileSystem } from '../../file-system/file-system';
import { CODE_AGENTS, appSkills, loadWorkspaceConfig, parseFrontmatter } from './workspace-config';
import { APP_SKILL_FILES, SRC } from '../../app-files/app-files';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-config-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// The app skill as loadWorkspaceConfig lists it, with the description its SKILL.md gives.
const APP_SKILL = {
  name: 'collaborative-editing',
  description: expect.stringContaining('draft') as unknown as string,
  path: '3pitor://skills/collaborative-editing/SKILL.md',
};
const PROOFREAD_SKILL = {
  name: 'proofread',
  description: expect.stringContaining('Proofreads') as unknown as string,
  path: '3pitor://skills/proofread/SKILL.md',
};
const RESEARCH_SKILL = {
  name: 'research',
  description: expect.stringContaining('Researches') as unknown as string,
  path: '3pitor://skills/research/SKILL.md',
};

test('reads the app and fixture workspace skills, and the fixture agents then the code agents', async () => {
  const config = await loadWorkspaceConfig(createLocalFileSystem(join(SRC, 'fixtures/workspace')), APP_SKILL_FILES);
  expect(config.skills).toEqual([
    APP_SKILL,
    {
      name: 'doc-stats',
      description:
        'Report statistics about a markdown document (heading count, line count, word count). Use when the user asks for document stats.',
      path: '.claude/skills/doc-stats/SKILL.md',
    },
    PROOFREAD_SKILL,
    RESEARCH_SKILL,
  ]);
  expect(config.agents).toEqual([
    {
      name: 'proofreader',
      description: 'Proofreads a markdown document for spelling and grammar mistakes. Use when asked to proofread.',
      prompt:
        'You are a proofreader. Read the file you are given and list each spelling or grammar mistake you find.\n' +
        'Start your reply with the line "PROOFREADER REPORT" and then one bullet per mistake.\n' +
        'Do not edit any files.',
      tools: ['Read'],
    },
    ...CODE_AGENTS,
  ]);
  expect(CODE_AGENTS.map((a) => a.name)).toEqual(['title-writer']);
});

test('a workspace with no .claude folder has only the app skills and the code agents', async () => {
  expect(await loadWorkspaceConfig(createLocalFileSystem(workspace), APP_SKILL_FILES)).toEqual({ skills: [APP_SKILL, PROOFREAD_SKILL, RESEARCH_SKILL], agents: CODE_AGENTS });
});

// Writes one workspace agent file with the given frontmatter lines.
async function writeAgent(name: string, ...frontmatter: string[]) {
  await mkdir(join(workspace, '.claude/agents'), { recursive: true });
  await writeFile(join(workspace, '.claude/agents', `${name}.md`), ['---', ...frontmatter, '---', '', `${name} prompt`].join('\n'));
}

const fileAgent = async (name: string) => (await loadWorkspaceConfig(createLocalFileSystem(workspace), APP_SKILL_FILES)).agents.find((a) => a.name === name);

test('keeps only the Read and Glob tools an agent asks for', async () => {
  await writeAgent('editor', 'description: Edits', 'tools: Read, Edit, Glob, Bash');
  expect((await fileAgent('editor'))?.tools).toEqual(['Read', 'Glob']);
});

test('gives an agent with no tools line Read and Glob', async () => {
  await writeAgent('reader', 'description: Reads');
  expect((await fileAgent('reader'))?.tools).toEqual(['Read', 'Glob']);
});

test('treats a description that is not a string as missing', async () => {
  await writeAgent('listy', 'description:', '  - one', '  - two', 'tools: 7');
  expect(await fileAgent('listy')).toEqual({ name: 'listy', description: '', prompt: 'listy prompt', tools: ['Read', 'Glob'] });
});

test('skips a file whose frontmatter cannot be parsed, or never closes', async () => {
  await writeAgent('broken', 'description: [unclosed');
  await writeAgent('good', 'description: Fine');
  await mkdir(join(workspace, '.claude/skills/open'), { recursive: true });
  await writeFile(join(workspace, '.claude/skills/open/SKILL.md'), '---\ndescription: never closed\n');
  const config = await loadWorkspaceConfig(createLocalFileSystem(workspace), APP_SKILL_FILES);
  expect(config.agents.map((a) => a.name)).toEqual(['good', 'title-writer']);
  expect(config.skills).toEqual([APP_SKILL, PROOFREAD_SKILL, RESEARCH_SKILL]);
});

test('embeds every markdown file under src/skills, keyed by its path in that folder', async () => {
  const dir = join(SRC, 'skills');
  const onDisk: Record<string, string> = {};
  for await (const path of new Bun.Glob('**/*.md').scan({ cwd: dir })) onDisk[path] = await Bun.file(join(dir, path)).text();
  expect(Object.keys(onDisk)).toContain('collaborative-editing/SKILL.md');
  expect(APP_SKILL_FILES).toEqual(onDisk);
});

test('a workspace skill replaces the app skill of the same name', async () => {
  await mkdir(join(workspace, '.claude/skills/collaborative-editing'), { recursive: true });
  await writeFile(join(workspace, '.claude/skills/collaborative-editing/SKILL.md'), '---\ndescription: Mine\n---\n');
  expect((await loadWorkspaceConfig(createLocalFileSystem(workspace), APP_SKILL_FILES)).skills).toEqual([
    { name: 'collaborative-editing', description: 'Mine', path: '.claude/skills/collaborative-editing/SKILL.md' },
    PROOFREAD_SKILL,
    RESEARCH_SKILL,
  ]);
});

test('skips an app SKILL.md whose frontmatter cannot be parsed, and lists only SKILL.md files as skills', () => {
  expect(
    appSkills({
      'broken/SKILL.md': '---\ndescription: [unclosed\n---\n',
      'good/SKILL.md': '---\ndescription: Fine\n---\n',
      'good/references/notes.md': '---\ndescription: Not a skill\n---\n',
    }),
  ).toEqual([{ name: 'good', description: 'Fine', path: '3pitor://skills/good/SKILL.md' }]);
});

// The log is a note the server saves to disk, so keeping it under .3pitor/ keeps the editor on the draft.
test('the collaborative-editing skill keeps its session log under .3pitor/editing/, not pairing/', () => {
  const skill = APP_SKILL_FILES['collaborative-editing/SKILL.md'];
  expect(skill).toContain('`.3pitor/editing/{today, YYYY-MM-DD}-{slug}-content-edit.md`');
  expect(skill).toContain('Glob `.3pitor/editing/*-{slug}-content-edit.md`');
  expect(Object.values(APP_SKILL_FILES).filter((text) => text.includes('pairing/'))).toEqual([]);
});

test('skills and agents in a symlinked folder are not read', async () => {
  const shared = await mkdtemp(join(tmpdir(), '3pitor-shared-'));
  try {
    await mkdir(join(shared, 'stats'), { recursive: true });
    await writeFile(join(shared, 'stats/SKILL.md'), '---\ndescription: from a link\n---\n');
    await mkdir(join(workspace, '.claude'), { recursive: true });
    await symlink(shared, join(workspace, '.claude/skills'));
    const config = await loadWorkspaceConfig(createLocalFileSystem(workspace), APP_SKILL_FILES);
    expect(config.skills.map((s) => s.name)).not.toContain('stats');
  } finally {
    await rm(shared, { recursive: true, force: true });
  }
});

// The exact parsed descriptions of the app's skills: folded lines joined with spaces, the em dash kept, and the folded
// scalar's final newline kept. Pinned so a change of YAML parser cannot change what the model is told.
test('parses each app skill\'s description exactly', () => {
  expect(appSkills(APP_SKILL_FILES).map(({ name, description }) => ({ name, description }))).toEqual([
    {
      name: 'collaborative-editing',
      description:
        'Runs a collaborative content edit of a blog post draft: applies the accumulated editing lessons in a first pass, ' +
        'then pairs with the writer section by section, one stop per turn, giving an overview of each section before asking ' +
        'about and editing its paragraphs, to cut length, sharpen clarity, and smooth every transition, and closes by ' +
        'proposing new lessons for the writer to approve. Highlights the passages each stop discusses in the editor. Use when ' +
        'the writer asks to pair on, content-edit, tighten, trim, shorten, or fix the flow of a post draft, wants to edit a ' +
        'draft together section by section, or wants to resume an interrupted editing run. Does not do a quick final pass for ' +
        'typos, spelling, grammar, and punctuation; use proofread for that. Does not research a topic; use research.\n',
    },
    {
      name: 'proofread',
      description:
        'Proofreads one blog post in a single turn without asking questions: fixes spelling, typos, grammar, punctuation, ' +
        'capitalization, repeated words, inconsistent spellings, hyphenation, and number style, and broken markdown ' +
        'formatting, then highlights every changed passage in the editor for the writer to review. Use when the writer asks ' +
        'to proofread, spell-check, fix typos, or give a post a final pass before publishing. Makes only small edits that ' +
        "keep the writer's meaning and wording and never touches code. Does not rework flow, length, structure, or voice; " +
        'use collaborative-editing to edit a draft together section by section, or research to research a topic.\n',
    },
    {
      name: 'research',
      description:
        'Researches any topic or open-ended question — options, possible solutions, prior art, trade-offs, or how something ' +
        'works — within whatever limits the writer sets, by searching the web and reading material the writer provides, then ' +
        'saves an evidence-backed, self-validated report as a new research document of the post open in the editor that ' +
        'recommends an option and cites every source. Use when the writer wants to research a topic for a post, weigh options, survey prior art or the ' +
        'state of the art, check what sources say about a claim, or understand how something works before writing about it. ' +
        'Does not draft or edit a post; use collaborative-editing to edit a draft together, or proofread for a final pass on ' +
        'typos and grammar.\n',
    },
  ]);
});

test('reads a double-quoted frontmatter value, with its escapes', () => {
  expect(parseFrontmatter('---\nargument-hint: "[draft path] \\"quoted\\": yes"\n---\nbody')).toEqual({
    data: { 'argument-hint': '[draft path] "quoted": yes' },
    body: 'body',
  });
});

test('a duplicated frontmatter key takes its last value', () => {
  expect(parseFrontmatter('---\ndescription: First\ndescription: Last\n---\n')?.data).toEqual({ description: 'Last' });
});

test('frontmatter that is a scalar, null, or empty gives no fields', () => {
  expect(parseFrontmatter('---\njust text\n---\nbody')).toEqual({ data: {}, body: 'body' });
  expect(parseFrontmatter('---\n~\n---\nbody')).toEqual({ data: {}, body: 'body' });
  expect(parseFrontmatter('---\n---\nbody')).toEqual({ data: {}, body: 'body' });
});

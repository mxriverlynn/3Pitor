import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_SKILL_FILES, CODE_AGENTS, appSkills, loadWorkspaceConfig } from './workspace-config';
import { SRC } from '../paths';

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
  const config = await loadWorkspaceConfig(join(SRC, 'fixtures/workspace'));
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
  expect(await loadWorkspaceConfig(workspace)).toEqual({ skills: [APP_SKILL, PROOFREAD_SKILL, RESEARCH_SKILL], agents: CODE_AGENTS });
});

// Writes one workspace agent file with the given frontmatter lines.
async function writeAgent(name: string, ...frontmatter: string[]) {
  await mkdir(join(workspace, '.claude/agents'), { recursive: true });
  await writeFile(join(workspace, '.claude/agents', `${name}.md`), ['---', ...frontmatter, '---', '', `${name} prompt`].join('\n'));
}

const fileAgent = async (name: string) => (await loadWorkspaceConfig(workspace)).agents.find((a) => a.name === name);

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
  const config = await loadWorkspaceConfig(workspace);
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
  expect((await loadWorkspaceConfig(workspace)).skills).toEqual([
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

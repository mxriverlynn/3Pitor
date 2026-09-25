import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODE_AGENTS, loadWorkspaceConfig } from './workspace-config';
import { SRC } from './workspace';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-config-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test('reads the fixture workspace skills and agents, then the code agents', async () => {
  const config = await loadWorkspaceConfig(join(SRC, 'fixtures/workspace'));
  expect(config.skills).toEqual([
    {
      name: 'doc-stats',
      description:
        'Report statistics about a markdown document (heading count, line count, word count). Use when the user asks for document stats.',
      path: '.claude/skills/doc-stats/SKILL.md',
    },
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

test('a workspace with no .claude folder has no skills and only the code agents', async () => {
  expect(await loadWorkspaceConfig(workspace)).toEqual({ skills: [], agents: CODE_AGENTS });
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
  expect(config.skills).toEqual([]);
});

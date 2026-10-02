import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createLocalFileSystem } from '../local/local-file-system/local-file-system';
import { glob } from './glob';

let root: string;

const FILES = [
  'notes.md',
  '.dot.md',
  'a/b.md',
  'a/.h/c.md',
  'a/deep/d.md',
  'a/deep/.x.md',
  '.claude/skills/stats/SKILL.md',
  '.claude/agents/proofreader.md',
  '.git/h.md',
  'docs/readme.txt',
];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), '3pitor-glob-'));
  for (const file of FILES) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), file);
  }
  await symlink(join(root, 'a'), join(root, 'linked'));
  await symlink(join(root, 'notes.md'), join(root, 'link.md'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const sorted = async (keys: Promise<string[]>) => (await keys).sort();

test('finds the files a pattern matches, the way Bun.Glob scan does', async () => {
  const fileSystem = createLocalFileSystem(root);
  const patterns = ['**/*.md', '*.md', '.claude/skills/*/SKILL.md', '.claude/agents/*.md', '{a,.claude}/**', '.*', 'a/**/.x.md', 'docs/*'];
  for (const pattern of patterns) {
    for (const dot of [false, true]) {
      const expected = (await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true, dot }))).sort();
      expect({ pattern, dot, keys: await sorted(glob(fileSystem, pattern, { dot })) }).toEqual({ pattern, dot, keys: expected });
    }
  }
});

test('strips a leading "./" from the pattern', async () => {
  expect(await glob(createLocalFileSystem(root), './notes.md')).toEqual(['notes.md']);
});

test('never lists a hidden folder the pattern does not name', async () => {
  const fileSystem = createLocalFileSystem(root);
  const list = spyOn(fileSystem, 'list');
  await glob(fileSystem, '**/*.md');
  expect(list.mock.calls.map(([key]) => key)).not.toContain('.git');
});

test('gives nothing for a prefix that is missing or refused', async () => {
  const fileSystem = createLocalFileSystem(root);
  expect(await glob(fileSystem, 'missing/*.md')).toEqual([]);
  expect(await glob(fileSystem, 'linked/*.md')).toEqual([]);
});

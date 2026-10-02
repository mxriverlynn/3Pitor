// Every runtime file read and write goes through this package. These checks scan the source, so they run inside
// `make test` (the Makefile's test-server lists src/file-system) and a direct disk call anywhere else fails the build.
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..');
const REPO = join(SRC, '..');

// A direct use of the disk: an fs import of any form, Bun.file, Bun.write, or Bun.Glob.
const FS_API = [
  /(\bfrom|\bimport)\s+['"](node:)?fs(\/promises)?['"]/,
  /\b(require|import)\s*\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/,
  /\bBun\.file\s*\(/,
  /\bBun\.write\s*\(/,
  /\bBun\.Glob\b/,
];

// Named files only, so a new file beside one of them is still checked.
const FS_EXEMPT = [
  'src/engine/workspace-config/app-skills.macro.ts', // runs when the app is bundled, over the app's own skills
  'src/engine/chat/components/chat-test-helpers.ts', // builds test workspaces
  'src/engine/chat/components/fake-claude.ts', // a stand-in claude program for tests
  'src/engine/chat/components/fake-claude-on-path.ts', // puts the stand-in on PATH for tests
  'src/server/scripts/check.ts', // the end-to-end check reads the workspace to verify what landed
];

// What the engine may take from the package: the contract, never a particular backend.
const ENGINE_CONTRACT = new Set([
  'FileSystem', 'FileEntry', 'EntryKind', 'FileEvent', 'WatchOptions',
  'FileSystemError', 'FileSystemErrorReason', 'normalizeKey', 'parentKey', 'glob',
]);
const ENGINE_CONTRACT_EXEMPT = ['src/engine/chat/components/chat-test-helpers.ts'];

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

async function sources(): Promise<{ path: string; lines: string[] }[]> {
  const paths = await Array.fromAsync(new Bun.Glob('src/**/*.{ts,tsx}').scan({ cwd: REPO }));
  return Promise.all(paths.sort().map(async (path) => ({ path, lines: (await Bun.file(join(REPO, path)).text()).split('\n') })));
}

// path:line for each line that uses the disk directly.
export function fsHits(files: { path: string; lines: string[] }[]): string[] {
  return files.flatMap(({ path, lines }) =>
    lines.flatMap((line, i) => (FS_API.some((pattern) => pattern.test(line)) ? [`${path}:${i + 1}`] : [])),
  );
}

// path:line for each import of a package module other than the entry.
export function deepImportHits(files: { path: string; lines: string[] }[]): string[] {
  return files.flatMap(({ path, lines }) =>
    lines.flatMap((line, i) => (/['"][^'"]*file-system\/(?!file-system['"])[^'"]+['"]/.test(line) ? [`${path}:${i + 1}`] : [])),
  );
}

// path: name for each symbol imported or re-exported from the entry that is not part of the contract.
export function nonContractHits(files: { path: string; text: string }[]): string[] {
  return files.flatMap(({ path, text }) => {
    const clauses = [...text.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"][^'"]*file-system\/file-system['"]/g)];
    return clauses.flatMap(([, names]) =>
      names
        .split(',')
        .map((name) => name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
        .filter((name) => name && !ENGINE_CONTRACT.has(name))
        .map((name) => `${path}: ${name}`),
    );
  });
}

test('no production module outside src/file-system/ touches the disk directly', async () => {
  const files = (await sources()).filter(
    ({ path }) => !isTest(path) && !path.startsWith('src/file-system/') && !FS_EXEMPT.includes(path),
  );
  expect(fsHits(files)).toEqual([]);
});

test('nothing outside src/file-system/ imports a package module other than file-system/file-system', async () => {
  const files = (await sources()).filter(({ path }) => !path.startsWith('src/file-system/'));
  expect(deepImportHits(files)).toEqual([]);
});

test('engine production code imports only contract symbols from the file-system entry', async () => {
  const files = (await sources())
    .filter(({ path }) => path.startsWith('src/engine/') && !isTest(path) && !ENGINE_CONTRACT_EXEMPT.includes(path))
    .map(({ path, lines }) => ({ path, text: lines.join('\n') }));
  expect(nonContractHits(files)).toEqual([]);
});

test('every exemption names a file that exists', () => {
  for (const path of [...FS_EXEMPT, ...ENGINE_CONTRACT_EXEMPT]) expect({ path, exists: existsSync(join(REPO, path)) }).toEqual({ path, exists: true });
});

test('the checks catch every form of direct disk use, and leave other dynamic imports alone', () => {
  const planted = [
    "import { readFile } from 'node:fs';",
    "import 'fs';",
    "const fs = require('node:fs');",
    "const fs = await import('fs/promises');",
    'await Bun.file(path).text();',
    'await Bun.write(path, text);',
    'new Bun.Glob(pattern);',
  ];
  expect(fsHits([{ path: 'x.ts', lines: planted }])).toHaveLength(planted.length);
  expect(fsHits([{ path: 'x.ts', lines: ["const { render } = await import('@testing-library/react');"] }])).toEqual([]);
  expect(deepImportHits([{ path: 'x.ts', lines: ["import { x } from '../file-system/local/local-file-system/local-file-system';"] }])).toHaveLength(1);
  expect(nonContractHits([{ path: 'x.ts', text: "import { createLocalFileSystem, type FileSystem } from '../file-system/file-system';" }])).toEqual([
    'x.ts: createLocalFileSystem',
  ]);
});


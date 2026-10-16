// The posts package's import rules. These checks scan the source, so they run inside `make test` (the Makefile's
// test-server lists src/posts) and an import that breaks a rule anywhere fails the build.
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';

const REPO = join(import.meta.dir, '..', '..');

type Source = { path: string; lines: string[] };

// Test-only modules under src/posts/ that are not named *.test.ts. They may import bun:test, and only tests import
// them.
const TEST_ONLY = ['src/posts/components/describe-post-store.ts']; // the contract suite

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

async function sources(): Promise<Source[]> {
  const paths = await Array.fromAsync(new Bun.Glob('src/**/*.{ts,tsx}').scan({ cwd: REPO }));
  return Promise.all(paths.sort().map(async (path) => ({ path, lines: (await Bun.file(join(REPO, path)).text()).split('\n') })));
}

// An import of the package: a relative path that climbs to src/ and names posts/<module>. Anchored on the quote, so a
// string such as 'posts/b.md' is not an import. Group 1 is the module path inside src/posts/.
const PACKAGE_IMPORT = /['"](?:\.\.\/)+posts\/([^'"]+)['"]/;
const ENTRIES = new Set(['posts', 'post-error']);
const IMPORTERS = ['src/cli/', 'src/server/', 'src/engine/'];

// The module named by each import or export-from on a line: `from '…'`, a bare `import '…'`, or `import('…')`.
const SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const SUITE_IMPORT = /['"][^'"]*components\/describe-post-store['"]/;

const outside = (path: string) => !path.startsWith('src/posts/');

function lineHits(files: Source[], hit: (path: string, line: string) => boolean): string[] {
  return files.flatMap(({ path, lines }) => lines.flatMap((line, i) => (hit(path, line) ? [`${path}:${i + 1}`] : [])));
}

// path:line for each import of the package from a folder that may not import it.
export function outsiderHits(files: Source[]): string[] {
  return lineHits(files, (path, line) => outside(path) && !IMPORTERS.some((p) => path.startsWith(p)) && PACKAGE_IMPORT.test(line));
}

// path:line for each import of a package module other than its two entries.
export function deepImportHits(files: Source[]): string[] {
  return lineHits(files, (path, line) => {
    const module = outside(path) ? line.match(PACKAGE_IMPORT)?.[1] : undefined;
    return module !== undefined && !ENTRIES.has(module);
  });
}

// path: clause for each import or export of posts/posts in engine code that is not an `import type { … }`
// declaration.
// Only the declaration form is erased under every transpiler, so only it keeps every implementation out of the engine.
export function valueImportHits(files: { path: string; text: string }[]): string[] {
  return files.flatMap(({ path, text }) => {
    const clauses = [...text.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s+['"](?:\.\.\/)+posts\/posts['"]/g)].map(([clause]) => clause);
    const dynamic = [...text.matchAll(/\bimport\s*\(\s*['"](?:\.\.\/)+posts\/posts['"]/g)].map(([clause]) => clause);
    return [...clauses.filter((clause) => !/^import\s+type\s*\{[^}]*\}/.test(clause)), ...dynamic].map((clause) => `${path}: ${clause}`);
  });
}

// path:line for each import a production module of the package may not make. post-error.ts imports nothing; the others
// import only the package's own modules, the file-system entry, and shared/.
export function packageImportHits(files: Source[]): string[] {
  return lineHits(files, (path, line) =>
    [...line.matchAll(SPECIFIER)].some((match) => {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (path === 'src/posts/post-error.ts' || !specifier.startsWith('.')) return true;
      const target = posix.join(posix.dirname(path), specifier);
      return !(target.startsWith('src/posts/') || target === 'src/file-system/file-system' || target.startsWith('src/shared/'));
    }),
  );
}

// path:line for each import of the contract suite from anything but a test under src/posts/, and any line of posts.ts
// that names it.
export function suiteImportHits(files: Source[]): string[] {
  return lineHits(files, (path, line) =>
    path === 'src/posts/posts.ts' ? /describe-post-store/.test(line) : SUITE_IMPORT.test(line) && (outside(path) || !isTest(path)),
  );
}

test('the checks catch every planted rule break', () => {
  expect(outsiderHits([{ path: 'src/ui/x.ts', lines: ["import type { PostStore } from '../posts/posts';"] }])).toEqual(['src/ui/x.ts:1']);
  expect(outsiderHits([{ path: 'src/shared/x.ts', lines: ["import { PostError } from '../posts/post-error';"] }])).toEqual(['src/shared/x.ts:1']);
  expect(deepImportHits([{ path: 'src/server/x.ts', lines: ["import { createFilePostStore } from '../posts/file/file-post-store';"] }])).toEqual([
    'src/server/x.ts:1',
  ]);
  expect(
    valueImportHits([
      { path: 'src/engine/a.ts', text: "import { type PostStore } from '../posts/posts';" },
      { path: 'src/engine/b.ts', text: "import { createFilePostStore } from '../posts/posts';" },
      { path: 'src/engine/c.ts', text: "export type { PostStore } from '../posts/posts';" },
      { path: 'src/engine/d.ts', text: "const posts = await import('../posts/posts');" },
    ]),
  ).toHaveLength(4);
  expect(packageImportHits([{ path: 'src/posts/post-error.ts', lines: ["import { x } from './posts';"] }])).toEqual(['src/posts/post-error.ts:1']);
  expect(
    packageImportHits([
      {
        path: 'src/posts/file/file-post-store.ts',
        lines: ["import { startEngine } from '../../engine/engine';", "import { parse } from 'yaml';", "import { test } from 'bun:test';"],
      },
    ]),
  ).toHaveLength(3);
  expect(suiteImportHits([{ path: 'src/posts/file/file-post-store.ts', lines: ["import { describePostStore } from '../components/describe-post-store';"] }])).toEqual([
    'src/posts/file/file-post-store.ts:1',
  ]);
  expect(suiteImportHits([{ path: 'src/posts/posts.ts', lines: ["export { describePostStore } from './components/describe-post-store';"] }])).toEqual([
    'src/posts/posts.ts:1',
  ]);
});

test('the checks leave allowed imports and look-alike strings alone', () => {
  expect(outsiderHits([{ path: 'src/engine/x.ts', lines: ["import type { PostStore } from '../posts/posts';"] }])).toEqual([]);
  expect(outsiderHits([{ path: 'src/server/x.test.ts', lines: ["await fs.move('b.md', 'posts/b.md');"] }])).toEqual([]);
  expect(deepImportHits([{ path: 'src/cli/cli.ts', lines: ["import { createFilePostStore } from '../posts/posts';"] }])).toEqual([]);
  expect(valueImportHits([{ path: 'src/engine/a.ts', text: "import type { PostStore, Post } from '../posts/posts';\nimport { PostError } from '../posts/post-error';" }])).toEqual([]);
  expect(
    packageImportHits([
      {
        path: 'src/posts/file/file-post-store.ts',
        lines: [
          "import type { FileSystem } from '../../file-system/file-system';",
          "import { newEntryName } from '../../shared/entry-name';",
          "import { PostError } from '../post-error';",
          "import type { PostStore } from '../posts';",
        ],
      },
    ]),
  ).toEqual([]);
  expect(suiteImportHits([{ path: 'src/posts/file/file-post-store.test.ts', lines: ["import { describePostStore } from '../components/describe-post-store';"] }])).toEqual([]);
});

test('outside src/posts/, only cli, server, and engine import the package, and only through its two entries', async () => {
  const files = (await sources()).filter(({ path }) => outside(path));
  expect(outsiderHits(files)).toEqual([]);
  expect(deepImportHits(files)).toEqual([]);
});

test('engine production code imports posts/posts only with an import type declaration', async () => {
  const files = (await sources())
    .filter(({ path }) => path.startsWith('src/engine/') && !isTest(path))
    .map(({ path, lines }) => ({ path, text: lines.join('\n') }));
  expect(valueImportHits(files)).toEqual([]);
});

test('the package imports nothing but its own modules, the file-system entry, and shared/, and post-error imports nothing', async () => {
  const files = (await sources()).filter(({ path }) => !outside(path) && !isTest(path) && !TEST_ONLY.includes(path));
  expect(files.map(({ path }) => path)).toContain('src/posts/post-error.ts');
  expect(packageImportHits(files)).toEqual([]);
});

test('only tests under src/posts/ import the contract suite, and posts.ts does not export it', async () => {
  expect(suiteImportHits(await sources())).toEqual([]);
});

test('every exemption names a file that exists', () => {
  for (const path of TEST_ONLY) expect({ path, exists: existsSync(join(REPO, path)) }).toEqual({ path, exists: true });
});

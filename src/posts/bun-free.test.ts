// The package's production code runs wherever the engine does, so the engine can take a store without loading Bun-only
// code. This scan fails on Bun-only code in any production file of src/posts/, using the engine scan's definition of
// Bun-only code. Package tests and the test-only modules below may use Bun.
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { bunHits } from '../shared/bun-only-code';

const POSTS = import.meta.dir;

// Test-only modules, which run only under bun test. Named files only, so a new file beside one of them is still checked.
const EXEMPT = [
  'components/describe-post-store.ts', // the contract suite, which imports bun:test
];

// Every package .ts file but the tests and the exemptions, relative to src/posts/.
async function productionFiles(): Promise<{ path: string; lines: string[] }[]> {
  const paths = await Array.fromAsync(new Bun.Glob('**/*.ts').scan({ cwd: POSTS }));
  const production = paths.filter((path) => !path.endsWith('.test.ts') && !EXEMPT.includes(path)).sort();
  return Promise.all(production.map(async (path) => ({ path, lines: (await Bun.file(join(POSTS, path)).text()).split('\n') })));
}

test('posts production code has no Bun-only code', async () => {
  const files = await productionFiles();
  expect(files.map(({ path }) => path)).toContain('posts.ts');
  expect(bunHits(files)).toEqual([]);
});

test('every exemption names a file that exists', () => {
  for (const path of EXEMPT) expect({ path, exists: existsSync(join(POSTS, path)) }).toEqual({ path, exists: true });
});

// The engine's production code runs on any runtime that has Node's built-in modules, so a host other than Bun can
// reuse it. This scan fails on the Bun-only code that would stop it; `make check-node` loads and runs the engine on
// Node, which catches load failures a scan cannot see. Engine tests and the test helpers below may use Bun.
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { bunHits } from './components/bun-only-code';

const ENGINE = import.meta.dir;

// Test-only helpers, which run only under bun test. Named files only, so a new file beside one of them is still checked.
const EXEMPT = [
  'chat/components/fake-claude.ts', // a stand-in claude program, run by bun
  'chat/components/fake-claude-on-path.ts',
  'chat/components/chat-test-helpers.ts',
  'chat/components/test-model.ts',
  'chat/components/stub-tool-server.ts',
  'components/bun-only-code.ts', // the test-only definition of Bun-only code, shared with the posts package's scan
];

// Every engine .ts file but the tests and the helpers, relative to src/engine/.
async function productionFiles(): Promise<{ path: string; lines: string[] }[]> {
  const paths = await Array.fromAsync(new Bun.Glob('**/*.ts').scan({ cwd: ENGINE }));
  const production = paths.filter((path) => !path.endsWith('.test.ts') && !EXEMPT.includes(path)).sort();
  return Promise.all(production.map(async (path) => ({ path, lines: (await Bun.file(join(ENGINE, path)).text()).split('\n') })));
}

test('engine production code has no Bun-only code', async () => {
  const files = await productionFiles();
  expect(files.map(({ path }) => path)).toContain('engine.ts');
  expect(bunHits(files)).toEqual([]);
});

test('every exemption names a file that exists', () => {
  for (const path of EXEMPT) expect({ path, exists: existsSync(join(ENGINE, path)) }).toEqual({ path, exists: true });
});

test('the checks catch every form of Bun-only code, and leave Node code alone', () => {
  const planted = [
    'await Bun.sleep(1);',
    "import { $ } from 'bun';",
    "import { test } from 'bun:test';",
    "const sqlite = await import('bun:sqlite');",
    "import files from './macro' with { type: 'macro' };",
    "import text from './prompt.md' with { type: 'text' };",
    'const here = import.meta.dir;',
    'const main = import.meta.main;',
    "import { APP_SKILL_FILES } from '../app-files/app-files';",
  ];
  expect(bunHits([{ path: 'x.ts', lines: planted }])).toHaveLength(planted.length);
  const node = [
    "import { spawn } from 'node:child_process';",
    "import { parse } from 'yaml';",
    'const url = import.meta.url;',
    '// Bun and Node both provide this.',
  ];
  expect(bunHits([{ path: 'x.ts', lines: node }])).toEqual([]);
});

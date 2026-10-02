import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SRC, WORKSPACE_FIXTURE } from './paths';

// Fails when paths.ts leaves src/engine/: SRC would then name some other folder, and the fixture, .data
// and app skills paths built from it would quietly point at the wrong place.
test('the fixture workspace is the one under src/fixtures/', () => {
  expect(WORKSPACE_FIXTURE).toBe(join(SRC, 'fixtures/workspace'));
});

test('SRC is the src/ folder, which holds the server, the UI, the app skills and the fixtures', () => {
  for (const path of ['server/server.ts', 'ui/index.html', 'skills', 'fixtures/workspace']) expect(existsSync(join(SRC, path))).toBe(true);
});

import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SRC } from './paths';

// Fails when paths.ts leaves src/server/: SRC would then name some other folder, and the fixture, .data
// and app skills paths built from it would quietly point at the wrong place.
test('SRC is the src/ folder, which holds the server, the UI, the app skills and the fixtures', () => {
  for (const path of ['server/server.ts', 'ui/index.html', 'skills', 'fixtures/workspace']) expect(existsSync(join(SRC, path))).toBe(true);
});

// Puts fake-claude.ts first on PATH, as `claude`, for every test in the file that calls this. The fake is copied into
// a fresh folder and made runnable there, so the tests never depend on the file's mode in git.
import { afterAll, afterEach, beforeAll, beforeEach } from 'bun:test';
import { chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Restored after each test, so a test may set any of them.
const NAMES = ['PATH', 'FAKE_CLAUDE_LOG', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

// Returns the folder holding the fake, once the file's tests start.
export function fakeClaudeOnPath(): () => string {
  let bin = '';
  const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

  beforeAll(async () => {
    bin = await mkdtemp(join(tmpdir(), '3pitor-fake-claude-'));
    await copyFile(join(import.meta.dir, 'fake-claude.ts'), join(bin, 'claude'));
    await chmod(join(bin, 'claude'), 0o755);
  });
  afterAll(() => rm(bin, { recursive: true, force: true }));

  // The fake's first line, #!/usr/bin/env bun, needs the running bun on PATH too.
  beforeEach(() => {
    process.env.PATH = [bin, dirname(process.execPath)].join(':');
  });
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  return () => bin;
}

import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { USAGE } from './command-line';

// Starts 3pitor from source the way a person would, and returns what it printed and how it exited.
function run(args: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync(['bun', 'run', join(import.meta.dir, 'server.ts'), ...args], {
    env: { ...process.env, OPEN_BROWSER: '0', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
}

test('--version prints the version from source and exits cleanly, without starting', () => {
  expect(run(['--version'])).toEqual({ stdout: '3pitor dev\n', stderr: '', exitCode: 0 });
});

test('--help prints the usage line and exits cleanly, without starting', () => {
  expect(run(['--help'])).toEqual({ stdout: `${USAGE}\n`, stderr: '', exitCode: 0 });
});

test('--version touches no workspace, so it never creates the folder WORKSPACE names', async () => {
  const dir = await mkdtemp(join(tmpdir(), '3pitor-version-'));
  try {
    expect(run(['--version'], { WORKSPACE: join(dir, 'new') }).exitCode).toBe(0);
    expect(existsSync(join(dir, 'new'))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a bad --claude mode still stops startup with the reason and the usage line', () => {
  expect(run(['--claude=bogus'])).toEqual({
    stdout: '',
    stderr: `3pitor: --claude must be api, cli, or auto (got "bogus")\n${USAGE}\n`,
    exitCode: 2,
  });
});

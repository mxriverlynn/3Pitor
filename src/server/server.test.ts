import { expect, test } from 'bun:test';
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

// Where the server and the dev scripts keep their document workspaces, and how they seed them.
import { cp, exists, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Paths are anchored to src/ so the scripts work from any working directory.
export const SRC = resolve(import.meta.dir, '..');

const FIXTURE = join(SRC, 'fixtures/workspace');

// A workspace directory under src/.data/, which is not tracked by git.
export const dataDir = (name: string) => join(SRC, '.data', name);

// Seed the workspace from the fixture only if it does not exist yet, so edits survive restarts.
export async function ensureWorkspace(path: string): Promise<string> {
  if (!(await exists(path))) await cp(FIXTURE, path, { recursive: true });
  return path;
}

// Wipe the workspace and re-seed it from the fixture, so every run starts from the same files.
export async function resetWorkspace(path: string): Promise<string> {
  await rm(path, { recursive: true, force: true });
  await cp(FIXTURE, path, { recursive: true });
  return path;
}

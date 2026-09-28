// Where the server and the dev scripts keep their document workspaces, and how they seed them.
import { cp, exists, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { SRC } from '../paths';

const FIXTURE = join(SRC, 'fixtures/workspace');

// A workspace directory under src/.data/, which is not tracked by git.
export const dataDir = (name: string) => join(SRC, '.data', name);

// The workspace to open: the folder named on the command line, or the folder holding a named file.
// With no name, WORKSPACE (which the dev scripts point at a seeded copy of the fixture), else the
// folder the app was launched from. A name that does not exist also falls back to the launch folder.
export async function chooseWorkspace(name: string | undefined): Promise<string> {
  if (name) {
    const path = resolve(name);
    const info = await stat(path).catch(() => undefined);
    if (info?.isDirectory()) return path;
    if (info) return dirname(path);
    console.warn(`${name} does not exist; using ${process.cwd()} as the workspace`);
    return process.cwd();
  }
  if (process.env.WORKSPACE) return ensureWorkspace(resolve(process.env.WORKSPACE));
  return process.cwd();
}

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

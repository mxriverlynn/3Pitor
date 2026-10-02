// Which folder on disk the local file system opens, and how the dev scripts seed one. The caller passes in the
// WORKSPACE value and the fixture folder, so this package reads no environment and does not need to find src/.
import { cp, exists, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// The folder to open: the folder named on the command line, or the folder holding a named file. With no name,
// workspaceEnv (which the dev scripts point at a seeded copy of the fixture), else the folder the app was launched
// from. A name that does not exist also falls back to the launch folder. Always an absolute path.
export async function chooseWorkspace(
  name: string | undefined,
  options: { workspaceEnv: string | undefined; fixture: string },
): Promise<string> {
  if (name) {
    const path = resolve(name);
    const info = await stat(path).catch(() => undefined);
    if (info?.isDirectory()) return path;
    if (info) return dirname(path);
    console.warn(`${name} does not exist; using ${process.cwd()} as the workspace`);
    return process.cwd();
  }
  if (options.workspaceEnv) return ensureWorkspace(resolve(options.workspaceEnv), options.fixture);
  return process.cwd();
}

// Seed the workspace from the fixture only if it does not exist yet, so edits survive restarts.
export async function ensureWorkspace(path: string, fixture: string): Promise<string> {
  if (!(await exists(path))) await cp(fixture, path, { recursive: true });
  return path;
}

// Wipe the workspace and re-seed it from the fixture, so every run starts from the same files.
export async function resetWorkspace(path: string, fixture: string): Promise<string> {
  await rm(path, { recursive: true, force: true });
  await cp(fixture, path, { recursive: true });
  return path;
}

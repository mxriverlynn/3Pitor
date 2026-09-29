// The app's own state on disk: JSON files under <workspace>/.3pitor/. Writes to one path land in call order, and each
// one replaces the file whole, so a crash never leaves half a file.
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const stateFile = (workspace: string, name: 'session.json' | 'view.json') => join(workspace, '.3pitor', name);

// Missing or unparseable reads as undefined. Unparseable also warns, since a file was there.
export async function readJson(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  try {
    return JSON.parse(await file.text());
  } catch (error) {
    console.warn(`Could not read ${path}: ${(error as Error).message}`);
    return undefined;
  }
}

const pending = new Map<string, Promise<void>>();

// Captures the value when called. The returned promise rejects with this write's error; later writes to the same path
// still run.
export function writeJson(path: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  const write = (pending.get(path) ?? Promise.resolve()).then(async () => {
    await mkdir(dirname(path), { recursive: true });
    await keepOutOfGit(dirname(path));
    // The process id keeps two servers on one workspace from sharing a temp file.
    const temp = `${path}.${process.pid}.tmp`;
    await Bun.write(temp, text);
    await rename(temp, path);
  });
  pending.set(path, write.catch(() => {}));
  return write;
}

// Creates <folder>/.gitignore holding `*`, so git ignores the whole folder. One already there is left alone.
async function keepOutOfGit(folder: string) {
  try {
    await writeFile(join(folder, '.gitignore'), '*\n', { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

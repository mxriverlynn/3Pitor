// The app's own files in the workspace, under .3pitor/: its JSON state, and the notes the model writes there. Each
// write goes through the file system, which replaces the file whole and keeps writes to one key in call order.
import { FileSystemError, type FileSystem } from '../../file-system/file-system';

export const stateKey = (name: 'session.json' | 'view.json') => `.3pitor/${name}`;

const GITIGNORE = '.3pitor/.gitignore';

// Missing reads as undefined. Unreadable or unparseable also reads as undefined, with a warning, since a file was there.
export async function readJson(fileSystem: FileSystem, key: string): Promise<unknown> {
  try {
    return JSON.parse(await fileSystem.read(key));
  } catch (error) {
    if (error instanceof FileSystemError && error.reason === 'not-found') return undefined;
    console.warn(`Could not read ${key}: ${(error as Error).message}`);
    return undefined;
  }
}

// Captures the value when called. The returned promise rejects with this write's error; later writes still run.
export function writeJson(fileSystem: FileSystem, key: string, value: unknown): Promise<void> {
  return writeText(fileSystem, key, JSON.stringify(value));
}

// Captures `text` when called, and starts the write before any await, so writes to one key land in call order. Each
// write also makes sure .3pitor/.gitignore exists, holding `*`, so git ignores the whole folder; one already there is
// left alone. The returned promise rejects with the first failure, for this call only.
export async function writeText(fileSystem: FileSystem, key: string, text: string): Promise<void> {
  const write = fileSystem.write(key, text);
  const ignore = keepOutOfGit(fileSystem);
  await Promise.all([write, ignore]);
}

async function keepOutOfGit(fileSystem: FileSystem) {
  if ((await fileSystem.stat(GITIGNORE)) === undefined) await fileSystem.write(GITIGNORE, '*\n');
}

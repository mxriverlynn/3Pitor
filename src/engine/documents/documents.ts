// Documents: the workspace's markdown files and folders. The rules for what a document is live here; every read and
// write goes through the file system. It knows nothing about HTTP; the server's documents routes map requests to it
// and its errors to status codes.
import { basename, dirname } from 'node:path';
import { FileSystemError, parentKey, type FileSystem } from '../../file-system/file-system';
import type { DocumentEntry, FolderCount } from '../../shared/wire';

// A refusal the browser can show: `invalid` for a path or request that can never succeed, `not-found`
// for an item (or a target's parent folder) that is missing.
export class DocumentError extends Error {
  constructor(
    readonly reason: 'invalid' | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

// Names starting with "." are hidden: the tree never shows them, and paths through them are refused.
function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

// A key with any hidden segment, such as .3pitor/view.json. The watcher never tracks or reports these.
export const isHiddenKey = (key: string): boolean => key.split('/').some(isHiddenName);

// The path grammar: workspace-relative, "/" separators, no empty segment, and no segment that starts
// with "." or holds "\" or NUL. A file's last segment ends in ".md". It is narrower than the chat
// tools' rule for a post, so any name the tree shows can be sent to a chat.
export function checkPath(path: string, kind: 'file' | 'folder'): void {
  const segments = path.split('/');
  const valid = segments.every((s) => s !== '' && !isHiddenName(s) && !/[\\\0]/.test(s));
  if (!valid) throw new DocumentError('invalid', `${JSON.stringify(path)} is not a valid ${kind} name`);
  if (kind === 'file' && !path.endsWith('.md')) throw new DocumentError('invalid', `${path} is not a markdown file`);
}

// Turns the file system's refusals into the browser's two: a taken name is `invalid`. The message passes through.
async function asDocument<T>(act: Promise<T>): Promise<T> {
  try {
    return await act;
  } catch (error) {
    if (error instanceof FileSystemError) {
      throw new DocumentError(error.reason === 'not-found' ? 'not-found' : 'invalid', error.message);
    }
    throw error;
  }
}

// Every folder and .md file in the workspace, sorted by path with `<`. Hidden names are skipped, and so are symlinks,
// which the walk never follows, so a link loop cannot hang it. A folder deleted or replaced by a file while the walk is
// under way is left out; any other failure, or the workspace itself missing, fails the list.
export async function listEntries(fileSystem: FileSystem): Promise<DocumentEntry[]> {
  const entries: DocumentEntry[] = [];
  const walk = async (folder: string) => {
    const children = await fileSystem.list(folder).catch((e: unknown) => {
      if (!(e instanceof FileSystemError)) throw e;
      // The workspace itself missing is the server's problem, not a document the browser asked for.
      if (!folder) throw new Error(e.message);
      return [];
    });
    for (const { key, kind } of children) {
      if (isHiddenName(basename(key))) continue;
      if (kind === 'folder') {
        entries.push({ path: key, kind: 'folder' });
        await walk(key);
      } else if (kind === 'file' && key.endsWith('.md')) {
        entries.push({ path: key, kind: 'file' });
      }
    }
  };
  await walk('');
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function readDocument(fileSystem: FileSystem, path: string): Promise<string> {
  checkPath(path, 'file');
  return asDocument(fileSystem.read(path));
}

// Overwrites the file, creating any missing parent folders; Save writes a post the AI made in a new folder this way.
export async function writeDocument(fileSystem: FileSystem, path: string, content: string): Promise<void> {
  checkPath(path, 'file');
  await asDocument(fileSystem.write(path, content));
}

// Makes an empty folder, or a new file that starts with its name as a heading. Nothing creates folders along the way.
export async function createEntry(fileSystem: FileSystem, path: string, kind: 'file' | 'folder'): Promise<void> {
  checkPath(path, kind);
  const existing = await asDocument(fileSystem.stat(path));
  if (existing === 'other' && kind === 'file') throw new DocumentError('invalid', `${path} is a symlink`);
  if (existing) throw new DocumentError('invalid', `${path} already exists`);
  if ((await asDocument(fileSystem.stat(parentKey(path)))) !== 'folder') {
    throw new DocumentError('not-found', `${dirname(path)} was not found`);
  }
  if (kind === 'folder') await asDocument(fileSystem.createFolder(path));
  else await asDocument(fileSystem.write(path, `# ${basename(path, '.md')}\n`));
}

// Renames or moves a file or folder, which is what rename, "Move to…", and dragging all do. A symlink moves as a link,
// and is named like a file.
export async function moveEntry(fileSystem: FileSystem, from: string, to: string): Promise<void> {
  const kind = await existingKind(fileSystem, from);
  checkPath(to, kind);
  await asDocument(fileSystem.move(from, to));
}

// Everything a delete of the folder would remove, not counting the folder itself: every folder under it, and every
// other entry (hidden, non-markdown, or a symlink) as a file. Symlinks are counted, never followed. A file holds
// nothing.
export async function countContents(fileSystem: FileSystem, path: string): Promise<FolderCount> {
  const count = { files: 0, folders: 0 };
  if ((await existingKind(fileSystem, path)) !== 'folder') return count;
  const walk = async (folder: string) => {
    for (const { key, kind } of await asDocument(fileSystem.list(folder))) {
      if (kind !== 'folder') count.files++;
      else {
        count.folders++;
        await walk(key);
      }
    }
  };
  await walk(path);
  return count;
}

// Removes a file, or a folder and everything in it. A symlink, the item itself or one inside the folder, is removed as
// a link, and whatever it points at stays.
export async function deleteEntry(fileSystem: FileSystem, path: string): Promise<void> {
  await existingKind(fileSystem, path);
  await asDocument(fileSystem.delete(path));
}

// What an item that must exist is, checking its path against the grammar for that kind.
async function existingKind(fileSystem: FileSystem, path: string): Promise<'file' | 'folder'> {
  checkPath(path, 'folder');
  const found = await asDocument(fileSystem.stat(path));
  if (!found) throw new DocumentError('not-found', `${path} was not found`);
  const kind = found === 'folder' ? 'folder' : 'file';
  checkPath(path, kind);
  return kind;
}

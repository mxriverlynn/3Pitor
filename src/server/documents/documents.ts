// Documents: the workspace's markdown files and folders on disk. It knows the file system and nothing
// about HTTP; documents.routes.ts maps requests to it and its errors to status codes.
import type { Stats } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import type { DocumentEntry, FolderCount } from '../../shared/wire';
import { resolveInWorkspace } from '../components/workspace-path';

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

// The path grammar: workspace-relative, "/" separators, no empty segment, and no segment that starts
// with "." or holds "\" or NUL. A file's last segment ends in ".md". It is narrower than the chat
// tools' rule for a post, so any name the tree shows can be sent to a chat.
export function checkPath(path: string, kind: 'file' | 'folder'): void {
  const segments = path.split('/');
  const valid = segments.every((s) => s !== '' && !isHiddenName(s) && !/[\\\0]/.test(s));
  if (!valid) throw new DocumentError('invalid', `${JSON.stringify(path)} is not a valid ${kind} name`);
  if (kind === 'file' && !path.endsWith('.md')) throw new DocumentError('invalid', `${path} is not a markdown file`);
}

// Where an item lives on disk. The path must fit the grammar, and its parent folder, followed through
// symlinks, must be inside the workspace. `stat` describes the item itself, not a link's target, and is
// undefined when nothing is there.
async function locate(workspace: string, path: string, kind: 'file' | 'folder'): Promise<{ full: string; stat?: Stats }> {
  checkPath(path, kind);
  let parent: string;
  try {
    parent = resolveInWorkspace(workspace, dirname(path));
  } catch {
    throw new DocumentError('invalid', `${path} is outside the workspace`);
  }
  const full = join(parent, basename(path));
  const stat = await lstat(full).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  });
  return { full, stat };
}

// Locates a file that read, write, and create may open: never a symlink, whose target could be anywhere.
async function locateFile(workspace: string, path: string) {
  const item = await locate(workspace, path, 'file');
  if (item.stat?.isSymbolicLink()) throw new DocumentError('invalid', `${path} is a symlink`);
  return item;
}

// Every folder and .md file in the workspace, sorted by path with `<`. Hidden names are skipped, and so are symlinks,
// which the walk never follows, so a link loop cannot hang it. A folder deleted or replaced by a file while the walk is
// under way is left out; any other failure, or the workspace itself missing, fails the list.
export async function listEntries(workspace: string): Promise<DocumentEntry[]> {
  const entries: DocumentEntry[] = [];
  const walk = async (folder: string) => {
    const dirents = await readdir(join(workspace, folder), { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
      if (folder && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return [];
      throw e;
    });
    for (const dirent of dirents) {
      if (isHiddenName(dirent.name)) continue;
      const path = folder ? `${folder}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        entries.push({ path, kind: 'folder' });
        await walk(path);
      } else if (dirent.isFile() && dirent.name.endsWith('.md')) {
        entries.push({ path, kind: 'file' });
      }
    }
  };
  await walk('');
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function readDocument(workspace: string, path: string): Promise<string> {
  const { full, stat } = await locateFile(workspace, path);
  if (!stat) throw new DocumentError('not-found', `${path} was not found`);
  return readFile(full, 'utf8');
}

// Overwrites the file, creating any missing parent folders; Save writes a post the AI made in a new folder this way.
export async function writeDocument(workspace: string, path: string, content: string): Promise<void> {
  const { full } = await locateFile(workspace, path);
  await Bun.write(full, content);
}

// Makes an empty folder, or a new file that starts with its name as a heading.
export async function createEntry(workspace: string, path: string, kind: 'file' | 'folder'): Promise<void> {
  const item = kind === 'file' ? await locateFile(workspace, path) : await locate(workspace, path, 'folder');
  if (item.stat) throw new DocumentError('invalid', `${path} already exists`);
  await requireParent(item.full, path);
  if (kind === 'folder') await mkdir(item.full);
  else await writeFile(item.full, `# ${basename(path, '.md')}\n`);
}

// Renames or moves a file or folder, which is what rename, "Move to…", and dragging all do. A symlink moves as a link.
export async function moveEntry(workspace: string, from: string, to: string): Promise<void> {
  const source = await locateExisting(workspace, from);
  const kind = source.stat.isDirectory() ? 'folder' : 'file';
  const target = await locate(workspace, to, kind);
  // Compared on disk, so a letter-case variant or another route to the same folder is still caught.
  const realSource = source.stat.isSymbolicLink() ? source.full : await realpath(source.full);
  const targetParent = dirname(target.full);
  if (target.full === source.full || targetParent === realSource || targetParent.startsWith(realSource + sep)) {
    throw new DocumentError('invalid', `${from} cannot move into itself`);
  }
  // On a case-insensitive disk "Notes.md" finds "notes.md" itself; only that same item may be renamed over.
  const sameItem = target.stat?.dev === source.stat.dev && target.stat?.ino === source.stat.ino;
  if (target.stat && !sameItem) throw new DocumentError('invalid', `${to} already exists`);
  await requireParent(target.full, to);
  await rename(source.full, target.full);
}

// Everything a delete of the folder would remove, not counting the folder itself: every folder under it, and every
// other entry (hidden, non-markdown, or a symlink) as a file. Symlinks are counted, never followed.
export async function countContents(workspace: string, path: string): Promise<FolderCount> {
  const { full } = await locateExisting(workspace, path);
  const count = { files: 0, folders: 0 };
  const walk = async (folder: string) => {
    for (const dirent of await readdir(folder, { withFileTypes: true })) {
      if (!dirent.isDirectory()) count.files++;
      else {
        count.folders++;
        await walk(join(folder, dirent.name));
      }
    }
  };
  await walk(full);
  return count;
}

// Removes a file, or a folder and everything in it. A symlink, the item itself or one inside the folder, is removed as
// a link, and whatever it points at stays.
export async function deleteEntry(workspace: string, path: string): Promise<void> {
  const { full } = await locateExisting(workspace, path);
  await rm(full, { recursive: true });
}

// Locates an item that must exist, checking its path against the grammar for what it is on disk.
async function locateExisting(workspace: string, path: string) {
  const item = await locate(workspace, path, 'folder');
  if (!item.stat) throw new DocumentError('not-found', `${path} was not found`);
  checkPath(path, item.stat.isDirectory() ? 'folder' : 'file');
  return { full: item.full, stat: item.stat };
}

// Refuses an item whose parent folder is missing: nothing creates folders along the way except a save.
async function requireParent(full: string, path: string) {
  const isFolder = await stat(dirname(full)).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isFolder) throw new DocumentError('not-found', `${dirname(path)} was not found`);
}

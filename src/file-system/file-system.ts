// The file-system package: every runtime file read and write, behind one key-based contract, so the store behind it
// can be swapped. cli builds an instance and hands it to the engine. This module is the only one anything outside
// src/file-system/ imports, and the package imports no other package.

// "file": a regular file. "folder": a directory. "other": anything else, which on local disk is a symlink, socket,
// FIFO, or device; other backends never return it. Callers drop it from listings, count it as a file, and glob skips
// it; read and write refuse it.
export type EntryKind = 'file' | 'folder' | 'other';

export interface FileEntry {
  // The full key, not just the name.
  key: string;
  kind: EntryKind;
}

// Changes arrive in batches. A folder delete or rename is one event, and its descendants are implied. A created folder
// is followed by one created event for each key under it; no other order is promised. "changed" means the backend saw
// activity it could not describe: treat it as "re-list everything".
export type FileEvent =
  | { type: 'created'; key: string; kind: 'file' | 'folder' }
  | { type: 'deleted'; key: string; kind: 'file' | 'folder' }
  | { type: 'updated'; key: string; kind: 'file' }
  | { type: 'renamed'; from: string; to: string; kind: 'file' | 'folder' }
  | { type: 'changed' };

export interface WatchOptions {
  // Called for a folder key before the watcher descends into it, and for a file key before it is tracked. A key for
  // which this returns true is never walked, tracked, or reported, and neither is anything under it. Never called
  // with "".
  ignore?: (key: string) => boolean;
}

// Every method checks its keys against the key grammar first, and rejects a bad one as FileSystemError 'invalid'.
export interface FileSystem {
  // Where the files live, for display only. Local: the root exactly as given.
  readonly location: string;

  // What is at a key, without following links: undefined when nothing is there, or when a parent is missing or is not
  // a folder. A link as the last segment is 'other'; a link partway down is refused. "" is the root.
  stat(key: string): Promise<EntryKind | undefined>;

  // The file's text. A missing key is 'not-found'; a link or other non-regular item is 'invalid'.
  read(key: string): Promise<string>;

  // Replaces the whole file, so a reader never sees half of it, and creates missing parent folders. Writes to one key
  // land in call order. A folder or other non-regular item at the key is 'invalid'.
  write(key: string, text: string): Promise<void>;

  // The parent must exist and be a folder; an item already at the key is 'exists'.
  createFolder(key: string): Promise<void>;

  // A folder's direct children, in no order. "" lists the root. A missing key, or one that is not a folder, is
  // 'not-found'.
  list(folder: string): Promise<FileEntry[]>;

  // Waits for writes already queued under either key first. Refuses a move into itself, a taken target (unless it is
  // the same stored item, as a letter-case rename is), and a missing target parent. A link moves as a link.
  move(from: string, to: string): Promise<void>;

  // Removes a file, or a folder and everything in it, after writes already queued under the key. A link is removed as
  // a link.
  delete(key: string): Promise<void>;

  // Delivers non-empty batches of changes after each settled burst (100 ms quiet, 1 s at most) and returns an
  // unsubscribe that is safe to call twice. A throw from the listener is logged. Nothing is watched until this is
  // called.
  watch(listener: (events: FileEvent[]) => void, options?: WatchOptions): () => void;
}

export { FileSystemError, type FileSystemErrorReason } from './components/file-system-error';
export { normalizeKey, parentKey } from './components/keys';
export { glob } from './glob/glob';
export { createLocalFileSystem } from './local/local-file-system/local-file-system';
export { chooseWorkspace, ensureWorkspace, resetWorkspace } from './local/workspace/workspace';

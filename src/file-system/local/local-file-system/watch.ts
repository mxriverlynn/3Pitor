// The local backend's watcher. The operating system says only that something happened at a path, and on macOS calls
// every change a "rename", so this keeps a snapshot of the tracked tree and, once a burst of changes has settled,
// walks it again and reports the difference as typed events.
import { watch } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileEvent, WatchOptions } from '../../file-system';
import { parentKey } from '../../components/keys';

type Tracked = { kind: 'file' | 'folder'; dev: number; ino: number; mtimeMs: number; size: number };
type Snapshot = Map<string, Tracked>;

// The local file system's own temp files: ".<name>.<pid>.tmp". They are never tracked, so a save reads as one update.
const TEMP_NAME = /^\..+\.\d+\.tmp$/;

// Calls listener with each non-empty batch, once a burst has settled: 100 ms after the last change, or 1 s after the
// first, so something that keeps writing is still reported. Past `limit` tracked entries it stops keeping a snapshot,
// and reports each burst as one "changed".
export function watchLocal(
  root: string,
  listener: (events: FileEvent[]) => void,
  options: WatchOptions,
  limit = 10_000,
): () => void {
  const ignore = options.ignore ?? (() => false);
  let snapshot: Snapshot | undefined;
  let coarse = false;
  let closed = false;
  let building = true;
  let activity = false;
  let touched = new Set<string>();
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let cap: ReturnType<typeof setTimeout> | undefined;
  // Settles run one at a time, in order.
  let settling = Promise.resolve();

  const ignored = (key: string) => {
    const segments = key.split('/');
    return segments.some((_, i) => ignore(segments.slice(0, i + 1).join('/')));
  };

  const stop = (error: unknown) => {
    if (closed) return;
    console.error(`Stopped watching the workspace: ${(error as Error).message}`);
    unsubscribe();
  };

  const deliver = (events: FileEvent[]) => {
    if (closed || events.length === 0) return;
    try {
      listener(events);
    } catch (error) {
      console.error(`Could not report a workspace change: ${(error as Error).message}`);
    }
  };

  // Walks the tracked tree. Returns undefined, and switches to coarse reporting, once it holds more than `limit`.
  const walk = async (): Promise<Snapshot | undefined> => {
    const found: Snapshot = new Map();
    const visit = async (folder: string): Promise<boolean> => {
      const dirents = await readdir(folder ? join(root, folder) : root, { withFileTypes: true }).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return [];
          throw e;
        },
      );
      for (const dirent of dirents) {
        if (TEMP_NAME.test(dirent.name) || !(dirent.isFile() || dirent.isDirectory())) continue;
        const key = folder ? `${folder}/${dirent.name}` : dirent.name;
        if (ignore(key)) continue;
        const stats = await lstat(join(root, key)).catch(() => undefined);
        if (!stats || !(stats.isFile() || stats.isDirectory())) continue;
        const kind = stats.isDirectory() ? 'folder' : 'file';
        found.set(key, { kind, dev: stats.dev, ino: stats.ino, mtimeMs: stats.mtimeMs, size: stats.size });
        if (found.size > limit) return false;
        if (kind === 'folder' && !(await visit(key))) return false;
      }
      return true;
    };
    if (await visit('')) return found;
    coarse = true;
    console.warn(`Watching the workspace without change details: more than ${limit} entries`);
    return undefined;
  };

  const settle = async () => {
    const sawActivity = activity;
    const sawTouched = touched;
    activity = false;
    touched = new Set();
    if (closed || !sawActivity) return;
    if (coarse || !snapshot) return deliver([{ type: 'changed' }]);
    const next = await walk();
    if (closed) return;
    if (!next) {
      snapshot = undefined;
      return deliver([{ type: 'changed' }]);
    }
    const events = diff(snapshot, next, sawTouched);
    snapshot = next;
    deliver(events.length ? events : [{ type: 'changed' }]);
  };

  const schedule = () => {
    clearTimeout(quiet);
    clearTimeout(cap);
    quiet = cap = undefined;
    settling = settling.then(settle).catch(stop);
  };

  const arm = () => {
    clearTimeout(quiet);
    quiet = setTimeout(schedule, 100);
    cap ??= setTimeout(schedule, 1000);
  };

  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (closed) return;
    if (filename != null) {
      const key = filename.split(/[\\/]/).join('/');
      if (TEMP_NAME.test(key.slice(key.lastIndexOf('/') + 1)) || ignored(key)) return;
      if (snapshot?.get(key)?.kind === 'file') touched.add(key);
    }
    activity = true;
    if (!building) arm();
  });
  watcher.on('error', stop);

  walk().then(
    (built) => {
      snapshot = built;
      building = false;
      if (activity) arm();
    },
    stop,
  );

  function unsubscribe() {
    if (closed) return;
    closed = true;
    clearTimeout(quiet);
    clearTimeout(cap);
    snapshot = undefined;
    watcher.close();
  }
  return unsubscribe;
}

// The difference between two walks. A key that left and a key that arrived as the same item (same device, inode, and
// kind) is a rename, and a renamed folder's contents are implied. A deleted folder is one event. A created folder is
// followed by everything created under it. A file that stayed is updated when it was replaced, its time or size
// changed, or the operating system reported it.
function diff(before: Snapshot, after: Snapshot, touched: Set<string>): FileEvent[] {
  const gone = new Set([...before.keys()].filter((key) => !after.has(key)));
  const added = [...after.keys()].filter((key) => !before.has(key)).sort();
  const events: FileEvent[] = [];
  const under = (prefix: string) => (key: string) => key.startsWith(`${prefix}/`);

  const renamedTo = new Set<string>();
  for (const to of added) {
    if ([...renamedTo].some((prefix) => under(prefix)(to))) continue;
    const now = after.get(to)!;
    const from = [...gone].find((key) => {
      const was = before.get(key)!;
      return was.kind === now.kind && was.dev === now.dev && was.ino === now.ino;
    });
    if (from === undefined) continue;
    events.push({ type: 'renamed', from, to, kind: now.kind });
    renamedTo.add(to);
    gone.delete(from);
    if (now.kind === 'folder') for (const key of [...gone].filter(under(from))) gone.delete(key);
  }

  for (const key of gone) {
    if (gone.has(parentKey(key)) && before.get(parentKey(key))?.kind === 'folder') continue;
    events.push({ type: 'deleted', key, kind: before.get(key)!.kind });
  }
  for (const key of added) {
    if (renamedTo.has(key) || [...renamedTo].some((prefix) => under(prefix)(key))) continue;
    events.push({ type: 'created', key, kind: after.get(key)!.kind });
  }
  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was || now.kind !== 'file' || was.kind !== 'file') continue;
    const replaced = was.ino !== now.ino || was.dev !== now.dev;
    if (replaced || was.mtimeMs !== now.mtimeMs || was.size !== now.size || touched.has(key)) {
      events.push({ type: 'updated', key, kind: 'file' });
    }
  }
  return events;
}

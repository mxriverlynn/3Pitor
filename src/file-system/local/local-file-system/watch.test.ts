import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileEvent } from '../../file-system';
import { createLocalFileSystem } from './local-file-system';
import { watchLocal } from './watch';

// Against the real file system. Waits poll rather than sleep for a fixed time, and "exactly once" means no further
// batch came in 400 ms of quiet afterwards.
let root: string;
let batches: FileEvent[][];
let unsubscribe: (() => void) | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), '3pitor-watch-'));
  await writeFile(join(root, 'notes.md'), '# Notes\n');
  batches = [];
});

afterEach(async () => {
  unsubscribe?.();
  unsubscribe = undefined;
  await rm(root, { recursive: true, force: true });
});

// macOS replays changes made just before the watch began, such as beforeEach's notes.md, so counting starts once
// those have settled.
const watch = async (options = {}, limit?: number) => {
  unsubscribe = watchLocal(root, (batch) => batches.push(batch), options, limit);
  await Bun.sleep(300);
  batches.length = 0;
};

const waitFor = async (condition: () => boolean) => {
  for (let waited = 0; !condition(); waited += 10) {
    if (waited >= 3000) throw new Error('timed out waiting');
    await Bun.sleep(10);
  }
};

// Waits for the first batch, then for 400 ms of quiet, and returns every batch seen.
const settled = async () => {
  await waitFor(() => batches.length > 0);
  await Bun.sleep(400);
  return batches;
};

test('creating a file is reported as created', async () => {
  await watch();
  await writeFile(join(root, 'a.md'), 'a');
  expect(await settled()).toEqual([[{ type: 'created', key: 'a.md', kind: 'file' }]]);
});

test('writing over a file in place is reported as updated', async () => {
  await watch();
  await writeFile(join(root, 'notes.md'), '# Changed, and longer\n');
  expect(await settled()).toEqual([[{ type: 'updated', key: 'notes.md', kind: 'file' }]]);
});

test('an in-place write of the same size is still reported as updated', async () => {
  await watch();
  await writeFile(join(root, 'notes.md'), '# Natos\n');
  expect(await settled()).toEqual([[{ type: 'updated', key: 'notes.md', kind: 'file' }]]);
});

test('a save through the file system is one update, with no temp file reported', async () => {
  await watch();
  await createLocalFileSystem(root).write('notes.md', '# Saved\n');
  expect(await settled()).toEqual([[{ type: 'updated', key: 'notes.md', kind: 'file' }]]);
});

test('renaming a file is reported as renamed', async () => {
  await watch();
  await rename(join(root, 'notes.md'), join(root, 'renamed.md'));
  expect(await settled()).toEqual([[{ type: 'renamed', from: 'notes.md', to: 'renamed.md', kind: 'file' }]]);
});

test('renaming a folder is one renamed event, with its contents implied', async () => {
  await mkdir(join(root, 'drafts'));
  await writeFile(join(root, 'drafts', 'a.md'), 'a');
  await watch();
  await rename(join(root, 'drafts'), join(root, 'posts'));
  expect(await settled()).toEqual([[{ type: 'renamed', from: 'drafts', to: 'posts', kind: 'folder' }]]);
});

test('deleting a folder full of files is one deleted event', async () => {
  await mkdir(join(root, 'drafts', '2026'), { recursive: true });
  await Promise.all(Array.from({ length: 10 }, (_, i) => writeFile(join(root, `drafts/2026/post-${i}.md`), '# Post\n')));
  await watch();
  await rm(join(root, 'drafts'), { recursive: true });
  expect(await settled()).toEqual([[{ type: 'deleted', key: 'drafts', kind: 'folder' }]]);
});

test('a write that makes a folder reports the folder, then the file in it', async () => {
  await watch();
  await createLocalFileSystem(root).write('new/x.md', 'x');
  expect(await settled()).toEqual([
    [
      { type: 'created', key: 'new', kind: 'folder' },
      { type: 'created', key: 'new/x.md', kind: 'file' },
    ],
  ]);
});

test('a file made and removed within one burst is reported as changed', async () => {
  await watch();
  await writeFile(join(root, 'brief.md'), 'b');
  await rm(join(root, 'brief.md'));
  expect(await settled()).toEqual([[{ type: 'changed' }]]);
});

test('fifty writes made together arrive as one batch', async () => {
  await watch();
  await Promise.all(Array.from({ length: 50 }, (_, i) => writeFile(join(root, `post-${i}.md`), `# Post ${i}\n`)));
  const seen = await settled();
  expect(seen).toHaveLength(1);
  expect(seen[0]).toHaveLength(50);
});

test('the watcher still reports while something keeps writing', async () => {
  await watch();
  for (let elapsed = 0; elapsed < 1500; elapsed += 50) {
    await writeFile(join(root, 'notes.md'), `# Changed ${elapsed}\n`);
    await Bun.sleep(50);
  }
  expect(batches.length).toBeGreaterThan(0);
});

test('an ignored folder is never walked, and changes only inside it report nothing', async () => {
  await mkdir(join(root, '.git', 'objects'), { recursive: true });
  await mkdir(join(root, '.3pitor'));
  const asked: string[] = [];
  await watch({ ignore: (key: string) => (asked.push(key), key.split('/').some((s) => s.startsWith('.'))) });
  await writeFile(join(root, '.3pitor', 'view.json'), '{}');
  await writeFile(join(root, '.git', 'objects', 'x'), 'x');
  await Bun.sleep(500);
  expect(batches).toEqual([]);
  expect(asked.filter((key) => key.startsWith('.git/'))).toEqual([]);
});

test('a symlink is never tracked, so making one reports only that something changed', async () => {
  await watch();
  await symlink(join(root, 'notes.md'), join(root, 'link.md'));
  expect(await settled()).toEqual([[{ type: 'changed' }]]);
});

test('past its limit the watcher warns once and reports each burst as changed', async () => {
  await Promise.all(Array.from({ length: 4 }, (_, i) => writeFile(join(root, `post-${i}.md`), '# Post\n')));
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await watch({}, 3);
    await writeFile(join(root, 'notes.md'), '# Changed\n');
    expect(await settled()).toEqual([[{ type: 'changed' }]]);
    expect(warn.mock.calls).toEqual([['Watching the workspace without change details: more than 3 entries']]);
  } finally {
    warn.mockRestore();
  }
});

test('a listener that throws is logged, and later batches still arrive', async () => {
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  try {
    let calls = 0;
    unsubscribe = watchLocal(root, () => {
      calls++;
      throw new Error('boom');
    }, {});
    await Bun.sleep(300);
    calls = 0;
    await writeFile(join(root, 'a.md'), 'a');
    await waitFor(() => calls === 1);
    await Bun.sleep(300);
    await writeFile(join(root, 'b.md'), 'b');
    await waitFor(() => calls === 2);
    expect(errors).toHaveBeenCalledWith('Could not report a workspace change: boom');
  } finally {
    errors.mockRestore();
  }
});

test('a folder the first walk cannot read stops the watcher with a log line', async () => {
  await mkdir(join(root, 'locked'));
  await chmod(join(root, 'locked'), 0o000);
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await watch();
    await writeFile(join(root, 'a.md'), 'a');
    await Bun.sleep(500);
    expect(batches).toEqual([]);
    expect(errors.mock.calls[0][0]).toStartWith('Stopped watching the workspace: ');
  } finally {
    errors.mockRestore();
    await chmod(join(root, 'locked'), 0o755);
  }
});

test('a change made during the first walk is reported once the walk is done', async () => {
  // Enough files that the first walk is still running when the change lands, after the OS watch is up.
  await mkdir(join(root, 'many'));
  await Promise.all(Array.from({ length: 3000 }, (_, i) => writeFile(join(root, 'many', `post-${i}.md`), '# Post\n')));
  unsubscribe = watchLocal(root, (batch) => batches.push(batch), {});
  await Bun.sleep(30);
  await writeFile(join(root, 'during.md'), 'd');
  await waitFor(() => batches.flat().some((e) => e.type === 'changed' || ('key' in e && e.key === 'during.md')));
});

test('unsubscribing before a burst settles delivers nothing, and is safe to repeat', async () => {
  await watch();
  await writeFile(join(root, 'notes.md'), '# Changed\n');
  await Bun.sleep(50);
  unsubscribe?.();
  unsubscribe?.();
  await Bun.sleep(400);
  expect(batches).toEqual([]);
});

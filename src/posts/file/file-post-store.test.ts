import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFileSystem, type FileSystem, FileSystemError } from '../../file-system/file-system';
import { describePostStore } from '../components/describe-post-store';
import { PostError } from '../post-error';
import { createFilePostStore } from './file-post-store';

// The local file system with some methods replaced. createLocalFileSystem returns a plain object, so spreading it
// keeps every other method working.
function wrap(fileSystem: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return { ...fileSystem, ...overrides };
}

// The underlying watch is turned off, so the only signals the suite sees are the store's own-write signals.
describePostStore('file', async () => {
  const root = await mkdtemp(join(tmpdir(), '3pitor-posts-'));
  const fileSystem = wrap(createLocalFileSystem(root), { watch: () => () => {} });
  return { store: createFilePostStore(fileSystem), dispose: () => rm(root, { recursive: true, force: true }) };
});

describe('file store', () => {
  let root: string;
  let fileSystem: FileSystem;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), '3pitor-posts-'));
    fileSystem = createLocalFileSystem(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // A post folder written straight to disk, the way posts exist today: a folder holding draft.md.
  async function onDisk(key: string, files: Record<string, string> = { 'draft.md': '' }) {
    await mkdir(join(root, key), { recursive: true });
    for (const [name, text] of Object.entries(files)) await writeFile(join(root, key, name), text);
  }

  const titled = { 'draft.md': '', '.post.json': '{"title":"T"}' };

  const ids = async (store: ReturnType<typeof createFilePostStore>) => (await store.list()).posts.map((post) => post.id).sort();

  test('a post in a nested folder is listed under its full key and can be got', async () => {
    await onDisk('series/one', { 'draft.md': 'first', '.post.json': '{"title":"One"}' });
    const store = createFilePostStore(fileSystem);
    expect(await store.list()).toEqual({ posts: [{ id: 'series/one', title: 'One' }] });
    expect(await store.get('series/one')).toEqual({ id: 'series/one', title: 'One', body: 'first' });
  });

  test('a post without a usable title file takes its folder name, or Untitled when that is blank', async () => {
    await onDisk('series/missing');
    await onDisk('not json', { 'draft.md': '', '.post.json': '{' });
    await onDisk('no title', { 'draft.md': '', '.post.json': '{"name":"x"}' });
    await onDisk('blank title', { 'draft.md': '', '.post.json': '{"title":"  "}' });
    await onDisk('folder title/.post.json');
    await writeFile(join(root, 'folder title', 'draft.md'), '');
    await onDisk('   ');
    const store = createFilePostStore(fileSystem);
    const titles = Object.fromEntries((await store.list()).posts.map((post) => [post.id, post.title]));
    expect(titles).toEqual({
      'series/missing': 'missing',
      'not json': 'not json',
      'no title': 'no title',
      'blank title': 'blank title',
      'folder title': 'folder title',
      '   ': 'Untitled',
    });
    expect((await store.get('series/missing')).title).toBe('missing');
  });

  test('a folder inside a post is not a post, and a draft.md at the root hides nothing', async () => {
    await onDisk('outer', titled);
    await onDisk('outer/inner', titled);
    await writeFile(join(root, 'draft.md'), '');
    const store = createFilePostStore(fileSystem);
    expect(await ids(store)).toEqual(['outer']);
    await expect(store.get('outer/inner')).rejects.toThrow(new PostError('not-found', 'post'));
    expect((await store.get('outer')).id).toBe('outer');
  });

  test('a folder whose name the file system cannot address is skipped by list and not-found when got', async () => {
    await onDisk('back\\slash', titled);
    await onDisk('kept', titled);
    const store = createFilePostStore(fileSystem);
    expect(await ids(store)).toEqual(['kept']);
    await expect(store.get('back\\slash')).rejects.toThrow(new PostError('not-found', 'post'));
  });

  test('a folder that vanishes while list walks is skipped', async () => {
    await onDisk('gone', titled);
    await onDisk('kept', titled);
    const local = createLocalFileSystem(root);
    const vanishing = wrap(local, {
      list: (key) => (key === 'gone' ? Promise.reject(new FileSystemError('not-found', 'gone was not found')) : local.list(key)),
    });
    expect(await ids(createFilePostStore(vanishing))).toEqual(['kept']);
  });

  test('a folder whose draft.md is not a regular file is not a post', async () => {
    await mkdir(join(root, 'odd', 'draft.md'), { recursive: true });
    const store = createFilePostStore(fileSystem);
    expect(await ids(store)).toEqual([]);
    await expect(store.get('odd')).rejects.toThrow(new PostError('not-found', 'post'));
  });

  test('a link to a post folder is never followed, by list or by an id that goes through it', async () => {
    await onDisk('real/post', titled);
    await symlink(join(root, 'real'), join(root, 'via'));
    const store = createFilePostStore(fileSystem);
    expect(await ids(store)).toEqual(['real/post']);
    await expect(store.get('via/post')).rejects.toThrow(new PostError('not-found', 'post'));
  });

  test('a missing workspace root fails list as a storage failure, and is not-found from get', async () => {
    const store = createFilePostStore(createLocalFileSystem(join(root, 'gone')));
    const failure = await store.list().then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(FileSystemError);
    expect(failure).not.toBeInstanceOf(PostError);
    await expect(store.get('anything')).rejects.toThrow(new PostError('not-found', 'post'));
  });

  test('an id the file system would refuse, or with a hidden segment, is not-found from every addressed call', async () => {
    await onDisk('a/b', titled);
    await onDisk('x', titled);
    const store = createFilePostStore(fileSystem);
    for (const id of ['../x', 'a//b', '/a', 'a\\b', '.', '.hidden', 'x/']) {
      const failure = await store.get(id).then(() => undefined, (error: unknown) => error);
      expect({ id, failure }).toEqual({ id, failure: new PostError('not-found', 'post') });
      expect(failure).toBeInstanceOf(PostError);
    }
  });

  test('a name this store deleted is skipped by create', async () => {
    const store = createFilePostStore(fileSystem);
    const first = await store.create({ title: 'Reused', body: '' });
    await store.delete(first);
    expect(first).toBe('Reused');
    expect(await store.create({ title: 'Reused', body: '' })).toBe('Reused 2');
  });

  test('a folder another writer makes at a deleted key stays invisible, but a post nested under it is found', async () => {
    const store = createFilePostStore(fileSystem);
    const id = await store.create({ title: 'series', body: '' });
    await store.delete(id);
    await onDisk('series', titled);
    expect(await ids(store)).toEqual([]);
    await expect(store.get('series')).rejects.toThrow(new PostError('not-found', 'post'));
    await rm(join(root, 'series', 'draft.md'));
    await onDisk('series/one', titled);
    expect(await ids(store)).toEqual(['series/one']);
    expect((await store.get('series/one')).id).toBe('series/one');
  });

  test('a post folder that vanishes between the check and the act is not-found from get and delete', async () => {
    await onDisk('fleeting', titled);
    const local = createLocalFileSystem(root);
    const missing = () => Promise.reject(new FileSystemError('not-found', 'fleeting was not found'));
    const store = createFilePostStore(wrap(local, { read: (key) => (key.endsWith('draft.md') ? missing() : local.read(key)), delete: missing }));
    await expect(store.get('fleeting')).rejects.toThrow(new PostError('not-found', 'post'));
    await expect(store.delete('fleeting')).rejects.toThrow(new PostError('not-found', 'post'));
    await expect(store.get('fleeting')).rejects.toThrow(new PostError('not-found', 'post'));
  });

  test('a folder name is cut to 200 bytes at a character boundary and trimmed again, or is Untitled', async () => {
    const store = createFilePostStore(fileSystem);
    const cases = [
      ['x'.repeat(199) + ' z', 'x'.repeat(199)],
      ['a'.repeat(199) + '\u00e9', 'a'.repeat(199)],
      ['y'.repeat(198) + '\u{1F600}', 'y'.repeat(198)],
      ['...', 'Untitled'],
    ];
    for (const [title, folder] of cases) {
      const id = await store.create({ title, body: '' });
      expect({ title, id }).toEqual({ title, id: folder });
      expect((await store.get(id)).title).toBe(title);
    }
  });

  // A disk that stores names decomposed and finds them in either form, the way HFS+ does: every key it reports is NFD,
  // and every key it is handed reaches the real disk as NFC.
  function decomposing(local: FileSystem, overrides: Partial<FileSystem> = {}): FileSystem {
    const nfc = (key: string) => key.normalize('NFC');
    return wrap(local, {
      list: async (key) => (await local.list(nfc(key))).map((entry) => ({ ...entry, key: entry.key.normalize('NFD') })),
      read: (key) => local.read(nfc(key)),
      write: (key, text, options) => local.write(nfc(key), text, options),
      createFolder: (key) => local.createFolder(nfc(key)),
      delete: (key) => local.delete(nfc(key)),
      ...overrides,
    });
  }

  test('on a disk that stores names decomposed, create gives the id list reports', async () => {
    const store = createFilePostStore(decomposing(fileSystem));
    const id = await store.create({ title: 'Caf\u00e9', body: 'b' });
    expect(id).toBe('Caf\u00e9'.normalize('NFD'));
    expect(await store.list()).toEqual({ posts: [{ id, title: 'Caf\u00e9' }] });
    expect(await store.get(id)).toEqual({ id, title: 'Caf\u00e9', body: 'b' });
  });

  test('when the new folder cannot be found in the listing, create removes it and fails as a storage failure', async () => {
    const local = createLocalFileSystem(root);
    const deleted: string[] = [];
    const remove = (key: string) => {
      deleted.push(key);
      return local.delete(key);
    };
    const listings: Record<string, (entries: Awaited<ReturnType<FileSystem['list']>>) => typeof entries> = {
      none: () => [],
      // Å as A plus a combining ring, and as the Angstrom sign: two names that are both \u00c5 in NFC.
      two: (entries) =>
        entries.flatMap((entry) => [
          { ...entry, key: entry.key.normalize('NFD') },
          { ...entry, key: entry.key.replace('\u00c5', '\u212b') },
        ]),
    };
    for (const [name, rewrite] of Object.entries(listings)) {
      const store = createFilePostStore(
        wrap(local, { list: async (key) => (key === '' ? rewrite(await local.list(key)) : local.list(key)), delete: remove }),
      );
      const failure = await store.create({ title: `\u00c5 ${name}`, body: '' }).then(() => undefined, (error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(PostError);
      expect(deleted.pop()).toBe(`\u00c5 ${name}`);
    }
    expect(await createLocalFileSystem(root).list('')).toEqual([]);
  });

  test('when the listed name of a new folder is one this store deleted, create moves on to the next name', async () => {
    const store = createFilePostStore(decomposing(fileSystem));
    const first = await store.create({ title: 'Caf\u00e9', body: '' });
    await store.delete(first);
    expect(await store.create({ title: 'Caf\u00e9', body: '' })).toBe('Caf\u00e9 2'.normalize('NFD'));
  });

  test('when a write in create fails, create removes the folder only if it holds nothing but its own files', async () => {
    const local = createLocalFileSystem(root);
    const disk = new Error('disk full');
    const failingDraft = (before?: (key: string) => Promise<void>) =>
      wrap(local, {
        write: async (key, text, options) => {
          if (!key.endsWith('draft.md')) return local.write(key, text, options);
          await before?.(key);
          throw disk;
        },
      });

    const alone = await createFilePostStore(failingDraft()).create({ title: 'Alone', body: '' }).catch((error: unknown) => error);
    expect(alone).toBe(disk);
    expect(await local.stat('Alone')).toBeUndefined();

    const shared = failingDraft((key) => local.write(key.replace('draft.md', 'notes.md'), 'someone else'));
    expect(await createFilePostStore(shared).create({ title: 'Shared', body: '' }).catch((error: unknown) => error)).toBe(disk);
    expect(await local.read('Shared/notes.md')).toBe('someone else');
  });

  test('a call on a new post made while create is still writing it waits for create, and sees the whole post', async () => {
    const local = createLocalFileSystem(root);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gated = wrap(local, {
      write: async (key, text, options) => {
        if (key.endsWith('draft.md')) await gate;
        return local.write(key, text, options);
      },
    });
    const store = createFilePostStore(gated);
    const creating = store.create({ title: 'Held', body: 'b' });
    // .post.json is written once create holds the new id's queue, before draft.md.
    while ((await local.stat('Held/.post.json')) !== 'file') await Bun.sleep(1);
    const early = store.get('Held');
    release();
    expect(await creating).toBe('Held');
    expect(await early).toEqual({ id: 'Held', title: 'Held', body: 'b' });
  });

  test('the store runs one file-system watch however many subscriptions, and stops it after the last', async () => {
    const local = createLocalFileSystem(root);
    let started = 0;
    let stopped = 0;
    const counting = wrap(local, {
      watch: (listener, options) => {
        started++;
        const stop = local.watch(listener, options);
        return () => {
          stopped++;
          stop();
        };
      },
    });
    const store = createFilePostStore(counting);
    const stops = [store.watch(() => {}), store.watch(() => {}), store.watch(() => {})];
    expect({ started, stopped }).toEqual({ started: 1, stopped: 0 });
    stops[0]();
    stops[1]();
    expect(stopped).toBe(0);
    stops[2]();
    stops[2]();
    expect({ started, stopped }).toEqual({ started: 1, stopped: 1 });
  });

  test('when the file-system watch cannot start, watch throws and subscribes nothing', async () => {
    const local = createLocalFileSystem(root);
    let fail = true;
    const flaky = wrap(local, {
      watch: (listener, options) => {
        if (fail) throw new Error('too many watchers');
        return () => {};
      },
    });
    const store = createFilePostStore(flaky);
    let calls = 0;
    expect(() => store.watch(() => calls++)).toThrow('too many watchers');
    await store.create({ title: 'Unheard', body: '' });
    expect(calls).toBe(0);
    fail = false;
    const stop = store.watch(() => calls++);
    await store.create({ title: 'Heard', body: '' });
    expect(calls).toBe(1);
    stop();
  });

  test('the store watches every post file, .post.json and .research.json included, and ignores other hidden names', () => {
    let ignore: ((key: string) => boolean) | undefined;
    const store = createFilePostStore(wrap(fileSystem, { watch: (_listener, options) => ((ignore = options?.ignore), () => {}) }));
    store.watch(() => {})();
    const ignored = ['.3pitor', '.claude', 'a/.trash', 'a/b/.DS_Store', 'a/draft.md', 'a/.post.json', 'a/research/r/.research.json', 'a', 'notes.md'].filter((key) => ignore?.(key));
    expect(ignored).toEqual(['.3pitor', '.claude', 'a/.trash', 'a/b/.DS_Store']);
  });

  test('a change that fails in storage still signals, since it may have landed', async () => {
    const local = createLocalFileSystem(root);
    const disk = new Error('disk full');
    const store = createFilePostStore(
      wrap(local, {
        watch: () => () => {},
        write: (key, text, options) => (key.endsWith('draft.md') && text === 'fails' ? Promise.reject(disk) : local.write(key, text, options)),
      }),
    );
    const id = await store.create({ title: 'Failing', body: '' });
    let calls = 0;
    const stop = store.watch(() => calls++);
    expect(await store.setBody(id, 'fails').catch((error: unknown) => error)).toBe(disk);
    expect(calls).toBe(1);
    stop();
  });

  describe('with the real watcher', () => {
    let stops: (() => void)[] = [];

    afterEach(() => {
      for (const stop of stops) stop();
      stops = [];
    });

    test('a change another writer makes is signalled', async () => {
      await onDisk('outside', titled);
      const store = createFilePostStore(fileSystem);
      let calls = 0;
      stops.push(store.watch(() => calls++));
      // Let the watcher take its first snapshot and settle macOS's replay of changes made just before it started.
      await Bun.sleep(300);
      calls = 0;
      await writeFile(join(root, 'outside', 'draft.md'), 'changed elsewhere');
      const deadline = Date.now() + 3000;
      while (calls === 0 && Date.now() < deadline) await Bun.sleep(20);
      expect(calls).toBeGreaterThanOrEqual(1);
    });
  });

  test('folders with a hidden name, or under one, are not posts', async () => {
    await onDisk('.3pitor');
    await onDisk('drafts/.trash/old');
    await onDisk('kept', { 'draft.md': '', '.post.json': '{"title":"Kept"}' });
    const store = createFilePostStore(fileSystem);
    expect(await ids(store)).toEqual(['kept']);
    for (const id of ['.3pitor', 'drafts/.trash/old']) await expect(store.get(id)).rejects.toThrow(new PostError('not-found', 'post'));
  });

  test('an outline.md already in a post folder is its outline, and a flat research.md is not a research document', async () => {
    await onDisk('the sun', { 'draft.md': '', 'outline.md': '- rises', 'research.md': '# Old research' });
    const store = createFilePostStore(fileSystem);
    expect(await store.getOutline('the sun')).toBe('- rises');
    expect(await store.listResearchDocuments('the sun')).toEqual({ researchDocuments: [] });
    expect(await store.get('the sun')).toEqual({ id: 'the sun', title: 'the sun', body: '' });
  });

  test('an outline.md that is not a regular file is no outline, is never removed, and blocks a write', async () => {
    await onDisk('odd/outline.md');
    await writeFile(join(root, 'odd', 'draft.md'), '');
    const store = createFilePostStore(fileSystem);
    expect(await store.getOutline('odd')).toBeNull();
    await store.setOutline('odd', null);
    expect(await stat(join(root, 'odd', 'outline.md')).then((info) => info.isDirectory())).toBe(true);
    const failure = await store.setOutline('odd', '- x').then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PostError);
  });

  test('a research document is a research/ subfolder named by its id, holding document.md and .research.json', async () => {
    const store = createFilePostStore(fileSystem);
    const postId = await store.create({ title: 'the sun', body: '' });
    const id = await store.createResearchDocument(postId, { title: 'Sources: one', body: 'report' });
    expect(id).toBe('Sources one');
    expect(await fileSystem.read(`the sun/research/${id}/document.md`)).toBe('report');
    expect(JSON.parse(await fileSystem.read(`the sun/research/${id}/.research.json`))).toEqual({ title: 'Sources: one' });
    await store.setResearchDocumentTitle(postId, id, 'Renamed');
    expect(await store.listResearchDocuments(postId)).toEqual({ researchDocuments: [{ id, title: 'Renamed' }] });
    expect(await fileSystem.stat(`the sun/research/${id}`)).toBe('folder');
  });

  test('only a non-hidden research subfolder holding a regular document.md is a research document, titled from its folder when need be', async () => {
    await onDisk('p', { 'draft.md': '' });
    await onDisk('p/research/untitled', { 'document.md': 'a' });
    await onDisk('p/research/bad json', { 'document.md': 'b', '.research.json': '{' });
    await onDisk('p/research/blank', { 'document.md': 'c', '.research.json': '{"title":" "}' });
    await onDisk('p/research/   ', { 'document.md': 'd' });
    await onDisk('p/research/empty', { 'notes.md': '' });
    await onDisk('p/research/.hidden', { 'document.md': '' });
    await onDisk('p/research/odd/document.md');
    await writeFile(join(root, 'p', 'research', 'loose.md'), '');
    const store = createFilePostStore(fileSystem);
    const titles = Object.fromEntries((await store.listResearchDocuments('p')).researchDocuments.map((d) => [d.id, d.title]));
    expect(titles).toEqual({ untitled: 'untitled', 'bad json': 'bad json', blank: 'blank', '   ': 'Untitled' });
    for (const id of ['empty', '.hidden', 'odd', 'loose.md']) {
      await expect(store.getResearchDocument('p', id)).rejects.toThrow(new PostError('not-found', 'research-document'));
    }
  });

  test('a research that is a file holds no research documents, and blocks making one', async () => {
    await onDisk('p', { 'draft.md': '', research: 'not a folder' });
    const store = createFilePostStore(fileSystem);
    expect(await store.listResearchDocuments('p')).toEqual({ researchDocuments: [] });
    await expect(store.getResearchDocument('p', 'x')).rejects.toThrow(new PostError('not-found', 'research-document'));
    const failure = await store.createResearchDocument('p', { title: 'x', body: '' }).then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PostError);
  });

  test('a research document another writer makes at a deleted id stays invisible, and create skips that id', async () => {
    const store = createFilePostStore(fileSystem);
    const postId = await store.create({ title: 'p', body: '' });
    const id = await store.createResearchDocument(postId, { title: 'Sources', body: '' });
    await store.deleteResearchDocument(postId, id);
    await onDisk(`p/research/${id}`, { 'document.md': 'recreated' });
    expect(await store.listResearchDocuments(postId)).toEqual({ researchDocuments: [] });
    await expect(store.getResearchDocument(postId, id)).rejects.toThrow(new PostError('not-found', 'research-document'));
    expect(await store.createResearchDocument(postId, { title: 'Sources', body: '' })).toBe('Sources 2');
  });

  test('a deleted research id is no tombstone for a post folder at the same path', async () => {
    const store = createFilePostStore(fileSystem);
    const postId = await store.create({ title: 'p', body: '' });
    const id = await store.createResearchDocument(postId, { title: 'Sources', body: '' });
    await store.deleteResearchDocument(postId, id);
    await store.delete(postId);
    await onDisk('p/research/Sources', titled);
    expect(await ids(store)).toEqual(['p/research/Sources']);
  });

  test('a body holding NUL round-trips through the file store', async () => {
    const store = createFilePostStore(fileSystem);
    const id = await store.create({ title: 'Nul', body: 'a\u0000b' });
    expect((await store.get(id)).body).toBe('a\u0000b');
  });
});

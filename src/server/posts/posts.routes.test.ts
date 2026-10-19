import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKSPACE_FIXTURE } from '../../app-files/app-files';
import { createLocalFileSystem } from '../../file-system/file-system';
import { createFilePostStore, type PostStore } from '../../posts/posts';
import { postRoutes } from './posts.routes';

let workspace: string;
let posts: PostStore;

beforeEach(async () => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), '3pitor-posts-routes-')));
  posts = createFilePostStore(createLocalFileSystem(workspace));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// The status and parsed body a request gets. A string body is sent as it stands.
const send = async (method: string, path: string, body?: unknown) => {
  const res = await postRoutes(posts).request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

test('lists every post with its id and title', async () => {
  const id = await posts.create({ title: 'The Sun', body: 'It rises.' });
  expect(await send('GET', '/api/posts')).toEqual({ status: 200, body: { posts: [{ id, title: 'The Sun' }] } });
});

test('gets one post by its encoded id, a nested one included', async () => {
  await createLocalFileSystem(workspace).write('series/one/draft.md', 'First.');
  expect(await send('GET', '/api/posts/series%2Fone')).toEqual({ status: 200, body: { id: 'series/one', title: 'one', body: 'First.' } });
});

test('an id that names no post is a 404 with the store’s sentence and its subject', async () => {
  expect(await send('GET', '/api/posts/never%20given')).toEqual({ status: 404, body: { error: 'That post no longer exists.', subject: 'post' } });
});

test('creates a post holding its title as its # heading, and answers with its id', async () => {
  const created = await send('POST', '/api/posts', { title: 'The Sun' });
  expect(created).toEqual({ status: 200, body: { id: 'The Sun' } });
  expect(await posts.get('The Sun')).toEqual({ id: 'The Sun', title: 'The Sun', body: '# The Sun' });
});

test('stores a new post’s title tidied, its runs of whitespace collapsed and its ends trimmed', async () => {
  const { body } = await send('POST', '/api/posts', { title: '  The   Moon ' });
  expect(await posts.get(body.id)).toEqual({ id: body.id, title: 'The Moon', body: '# The Moon' });
});

test('a taken title gets the next free id, a title with nothing usable makes Untitled, and a blank one is a 400', async () => {
  await send('POST', '/api/posts', { title: 'The Sun' });
  expect(await send('POST', '/api/posts', { title: 'The Sun' })).toEqual({ status: 200, body: { id: 'The Sun 2' } });
  expect(await send('POST', '/api/posts', { title: '???' })).toEqual({ status: 200, body: { id: 'Untitled' } });
  expect(await send('POST', '/api/posts', { title: '  ' })).toEqual({ status: 400, body: { error: 'A post needs a title.', subject: 'post' } });
});

test('a body that is not the route’s JSON is a 400 saying so', async () => {
  for (const body of ['not json', { name: 'The Sun' }]) {
    const { status, body: answer } = await send('POST', '/api/posts', body);
    expect({ status, error: String(answer.error).split(':')[0], subject: answer.subject }).toEqual({ status: 400, error: 'the request body is not valid', subject: undefined });
  }
});

test('renames a post by encoded id, rewriting its title row to match, with the title tidied', async () => {
  await createLocalFileSystem(workspace).write('series/one/draft.md', '# Old\n\nBody');
  expect(await send('PUT', '/api/posts/series%2Fone/title', { title: '  New  ' })).toEqual({ status: 200, body: { ok: true } });
  expect(await posts.get('series/one')).toEqual({ id: 'series/one', title: 'New', body: '# New\n\nBody' });
});

test('renaming a post with no # heading puts one at the top', async () => {
  const id = await posts.create({ title: 'Old', body: 'Intro para' });
  await send('PUT', `/api/posts/${id}/title`, { title: 'New' });
  expect(await posts.get(id)).toEqual({ id, title: 'New', body: '# New\n\nIntro para' });
});

test('a blank rename is a 400 that changes neither the title nor the body', async () => {
  const id = await posts.create({ title: 'Old', body: '# Old\n\nBody' });
  expect(await send('PUT', `/api/posts/${id}/title`, { title: ' \n ' })).toEqual({ status: 400, body: { error: 'A post needs a title.', subject: 'post' } });
  expect(await posts.get(id)).toEqual({ id, title: 'Old', body: '# Old\n\nBody' });
});

test('a rename whose title write fails is a 500 that leaves the new heading, and a retry finishes it', async () => {
  const id = await posts.create({ title: 'Old', body: '# Old\n\nBody' });
  const broken: PostStore = { ...posts, setTitle: async () => Promise.reject(new Error('the disk is full')) };
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const res = await postRoutes(broken).request(`/api/posts/${id}/title`, { method: 'PUT', body: JSON.stringify({ title: 'New' }) });
    expect(res.status).toBe(500);
  } finally {
    error.mockRestore();
  }
  expect(await posts.get(id)).toEqual({ id, title: 'Old', body: '# New\n\nBody' });

  expect(await send('PUT', `/api/posts/${id}/title`, { title: 'New' })).toEqual({ status: 200, body: { ok: true } });
  expect(await posts.get(id)).toEqual({ id, title: 'New', body: '# New\n\nBody' });
});

test('deletes a post by encoded id, and every later call on that id is a 404', async () => {
  await createLocalFileSystem(workspace).write('series/one/draft.md', 'First.');
  expect(await send('DELETE', '/api/posts/series%2Fone')).toEqual({ status: 200, body: { ok: true } });
  const gone = { status: 404, body: { error: 'That post no longer exists.', subject: 'post' } };
  expect(await send('GET', '/api/posts/series%2Fone')).toEqual(gone);
  expect(await send('PUT', '/api/posts/series%2Fone/title', { title: 'One' })).toEqual(gone);
  expect(await send('PUT', '/api/posts/series%2Fone/body', { body: 'Back?' })).toEqual(gone);
  expect(await send('DELETE', '/api/posts/series%2Fone')).toEqual(gone);
  expect(await posts.list()).toEqual({ posts: [] });
});

// Ids come from the browser, so any string may arrive. Only an id the store gave out reaches anything.
test('an encoded path out of the workspace or into its hidden files names no post', async () => {
  await createLocalFileSystem(workspace).write('.3pitor/config.json', '{}');
  await posts.create({ title: 'the sun', body: '' });
  for (const id of ['%2E%2E%2F.3pitor%2Fconfig.json', '.3pitor%2Fconfig.json', 'the%20sun%2F.post.json', 'series%2F..%2Fthe%20sun', 'the%20sun%2F'])
    expect({ id, ...(await send('GET', `/api/posts/${id}`)) }).toEqual({ id, status: 404, body: { error: 'That post no longer exists.', subject: 'post' } });
});

// The workspace a first run is copied from, so a new writer lands on a post rather than an empty list.
test('the shipped first-run workspace lists one post, notes', async () => {
  const fixture = createFilePostStore(createLocalFileSystem(WORKSPACE_FIXTURE));
  const res = await postRoutes(fixture).request('/api/posts');
  expect(await res.json()).toEqual({ posts: [{ id: 'notes', title: 'notes' }] });
});

// The ids a search answers, as a set: the route promises no order.
const matches = async (q: string) => {
  const { status, body } = await send('GET', `/api/posts?q=${q}`);
  return { status, ids: new Set(body.posts.map((post: { id: string }) => post.id)) };
};

test('a search matches a word in the title', async () => {
  const sun = await posts.create({ title: 'The Sun', body: 'It rises.' });
  await posts.create({ title: 'Moon', body: 'It waxes.' });
  expect(await matches('sun')).toEqual({ status: 200, ids: new Set([sun]) });
});

test('a search matches the saved body, ignoring case', async () => {
  const moon = await posts.create({ title: 'Moon', body: 'Pulls the TIDE.' });
  await posts.create({ title: 'Sun', body: 'It rises.' });
  expect(await matches('Tide')).toEqual({ status: 200, ids: new Set([moon]) });
});

test('a search that matches nothing answers no posts', async () => {
  await posts.create({ title: 'Moon', body: 'It waxes.' });
  expect(await send('GET', '/api/posts?q=comet')).toEqual({ status: 200, body: { posts: [] } });
});

test('a blank search answers every post', async () => {
  const moon = await posts.create({ title: 'Moon', body: '' });
  const sun = await posts.create({ title: 'Sun', body: '' });
  expect(await matches('%20')).toEqual({ status: 200, ids: new Set([moon, sun]) });
});

test('a search is trimmed before it matches', async () => {
  const moon = await posts.create({ title: 'Moon', body: 'the TIDE' });
  const pools = await posts.create({ title: 'Tidepools', body: '' });
  await posts.create({ title: 'Sun', body: 'tidy' });
  expect(await matches('%20tide%20')).toEqual({ status: 200, ids: new Set([moon, pools]) });
});

// The bodies are read after the list, so a post can be deleted in between.
test('a search leaves out a post deleted after the list was read, and answers the rest', async () => {
  const moon = await posts.create({ title: 'Moon', body: 'the tide' });
  const pools = await posts.create({ title: 'Pools', body: 'low tide' });
  const racing: PostStore = {
    ...posts,
    list: async () => {
      const listed = await posts.list();
      await posts.delete(pools);
      return listed;
    },
  };
  const res = await postRoutes(racing).request('/api/posts?q=tide');
  expect({ status: res.status, body: await res.json() }).toEqual({ status: 200, body: { posts: [{ id: moon, title: 'Moon' }] } });
});

test('a search whose body read fails for another reason is a 500', async () => {
  await posts.create({ title: 'Moon', body: 'the tide' });
  const broken: PostStore = { ...posts, get: async () => Promise.reject(new Error('the disk went away')) };
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const res = await postRoutes(broken).request('/api/posts?q=tide');
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 500, body: 'Internal Server Error' });
  } finally {
    error.mockRestore();
  }
});

test('lists a post’s documents: whether it has an outline, and its research documents', async () => {
  const id = await posts.create({ title: 'the sun', body: '' });
  expect(await send('GET', '/api/posts/the%20sun/documents')).toEqual({ status: 200, body: { outline: false, researchDocuments: [] } });
  const research = await posts.createResearchDocument(id, { title: 'Sources', body: 'report' });
  await posts.setOutline(id, '');
  expect(await send('GET', '/api/posts/the%20sun/documents')).toEqual({
    status: 200,
    body: { outline: true, researchDocuments: [{ id: research, title: 'Sources' }] },
  });
});

test('gets and sets a post’s outline, null when it has none', async () => {
  await createLocalFileSystem(workspace).write('series/one/draft.md', '');
  expect(await send('GET', '/api/posts/series%2Fone/outline')).toEqual({ status: 200, body: { outline: null } });
  expect(await send('PUT', '/api/posts/series%2Fone/outline', { outline: '- one' })).toEqual({ status: 200, body: { ok: true } });
  expect(await send('GET', '/api/posts/series%2Fone/outline')).toEqual({ status: 200, body: { outline: '- one' } });
  expect(await posts.getOutline('series/one')).toBe('- one');
  const { status, body } = await send('PUT', '/api/posts/series%2Fone/outline', { outline: null });
  expect({ status, subject: body.subject }).toEqual({ status: 400, subject: undefined });
});

test('gets, saves, and deletes a research document by encoded ids', async () => {
  const id = await posts.create({ title: 'the sun', body: '' });
  const research = await posts.createResearchDocument(id, { title: 'Sources 1/2', body: 'old' });
  const path = `/api/posts/the%20sun/research/${encodeURIComponent(research)}`;
  expect(await send('GET', path)).toEqual({ status: 200, body: { id: research, title: 'Sources 1/2', body: 'old' } });
  expect(await send('PUT', `${path}/body`, { body: 'new' })).toEqual({ status: 200, body: { ok: true } });
  expect(await posts.getResearchDocument(id, research)).toEqual({ id: research, title: 'Sources 1/2', body: 'new' });
  expect(await send('DELETE', path)).toEqual({ status: 200, body: { ok: true } });
  expect(await posts.listResearchDocuments(id)).toEqual({ researchDocuments: [] });
});

test('a missing research document is a 404 about the research document, and a missing post a 404 about the post', async () => {
  await posts.create({ title: 'the sun', body: '' });
  const documentGone = { status: 404, body: { error: 'That research document no longer exists.', subject: 'research-document' } };
  expect(await send('GET', '/api/posts/the%20sun/research/Gone')).toEqual(documentGone);
  expect(await send('PUT', '/api/posts/the%20sun/research/Gone/body', { body: 'b' })).toEqual(documentGone);
  expect(await send('DELETE', '/api/posts/the%20sun/research/Gone')).toEqual(documentGone);
  const postGone = { status: 404, body: { error: 'That post no longer exists.', subject: 'post' } };
  for (const [method, path, body] of [
    ['GET', '/api/posts/Gone/documents'],
    ['GET', '/api/posts/Gone/outline'],
    ['PUT', '/api/posts/Gone/outline', { outline: '' }],
    ['GET', '/api/posts/Gone/research/x'],
    ['PUT', '/api/posts/Gone/research/x/body', { body: '' }],
    ['DELETE', '/api/posts/Gone/research/x'],
  ] as const) {
    expect({ method, path, ...(await send(method, path, body)) }).toEqual({ method, path, ...postGone });
  }
});

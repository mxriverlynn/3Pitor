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

test('an id that names no post is a 404 with the store’s sentence', async () => {
  expect(await send('GET', '/api/posts/never%20given')).toEqual({ status: 404, body: { error: 'That post no longer exists.' } });
});

test('creates an empty post from a title and answers with its id', async () => {
  const created = await send('POST', '/api/posts', { title: 'The Sun' });
  expect(created).toEqual({ status: 200, body: { id: 'The Sun' } });
  expect(await posts.get('The Sun')).toEqual({ id: 'The Sun', title: 'The Sun', body: '' });
});

test('a taken title gets the next free id, a title with nothing usable makes Untitled, and a blank one is a 400', async () => {
  await send('POST', '/api/posts', { title: 'The Sun' });
  expect(await send('POST', '/api/posts', { title: 'The Sun' })).toEqual({ status: 200, body: { id: 'The Sun 2' } });
  expect(await send('POST', '/api/posts', { title: '???' })).toEqual({ status: 200, body: { id: 'Untitled' } });
  expect(await send('POST', '/api/posts', { title: '  ' })).toEqual({ status: 400, body: { error: 'A post needs a title.' } });
});

test('a body that is not the route’s JSON is a 400 saying so', async () => {
  for (const body of ['not json', { name: 'The Sun' }]) {
    const { status, body: answer } = await send('POST', '/api/posts', body);
    expect({ status, error: String(answer.error).split(':')[0] }).toEqual({ status: 400, error: 'the request body is not valid' });
  }
});

test('sets a post’s title and its body separately, by encoded id', async () => {
  await createLocalFileSystem(workspace).write('series/one/draft.md', 'First.');
  expect(await send('PUT', '/api/posts/series%2Fone/title', { title: 'One' })).toEqual({ status: 200, body: { ok: true } });
  expect(await send('PUT', '/api/posts/series%2Fone/body', { body: 'Second.' })).toEqual({ status: 200, body: { ok: true } });
  expect(await posts.get('series/one')).toEqual({ id: 'series/one', title: 'One', body: 'Second.' });
});

test('deletes a post by encoded id, and every later call on that id is a 404', async () => {
  await createLocalFileSystem(workspace).write('series/one/draft.md', 'First.');
  expect(await send('DELETE', '/api/posts/series%2Fone')).toEqual({ status: 200, body: { ok: true } });
  const gone = { status: 404, body: { error: 'That post no longer exists.' } };
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
    expect({ id, ...(await send('GET', `/api/posts/${id}`)) }).toEqual({ id, status: 404, body: { error: 'That post no longer exists.' } });
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

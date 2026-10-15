import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_SKILL_FILES } from '../../app-files/app-files';
import { createEngine } from '../../engine/engine';
import { serveTools } from '../chat/mcp-endpoint/mcp-endpoint';
import { documentRoutes } from './documents.routes';
import { createLocalFileSystem } from '../../file-system/file-system';

let root: string;
let workspace: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), '3pitor-documents-routes-')));
  workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'notes.md'), '# Notes\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// The status and body text a request gets.
const send = async (method: string, path: string, body?: unknown) => {
  const res = await documentRoutes(createEngine({ fileSystem: createLocalFileSystem(workspace), appSkillFiles: APP_SKILL_FILES, env: { ANTHROPIC_API_KEY: 'test' }, isOnPath: () => true, serveTools }).documents).request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
};

test('loads a nested file by its encoded name', async () => {
  await mkdir(join(workspace, 'drafts'));
  await writeFile(join(workspace, 'drafts/soil.md'), '# Soil\n');
  expect(await send('GET', '/api/documents/drafts%2Fsoil.md')).toEqual({
    status: 200,
    body: '{"name":"drafts/soil.md","content":"# Soil\\n"}',
  });
});

test('answers a missing file with 404 and a sentence', async () => {
  expect(await send('GET', '/api/documents/nope.md')).toEqual({ status: 404, body: '{"error":"nope.md was not found"}' });
});

test('answers a path that leaves the workspace with 400 and a sentence', async () => {
  expect(await send('GET', '/api/documents/..%2Fsecret.md')).toEqual({
    status: 400,
    body: '{"error":"\\"../secret.md\\" is not a valid file name"}',
  });
});

test('saves over a file and answers ok', async () => {
  expect(await send('PUT', '/api/documents/notes.md', { content: '# Garden\n' })).toEqual({ status: 200, body: '{"ok":true}' });
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Garden\n');
});

test('refuses to save a file that is not markdown, or one in a dot-folder', async () => {
  expect(await send('PUT', '/api/documents/notes.txt', { content: 'x' })).toEqual({
    status: 400,
    body: '{"error":"notes.txt is not a markdown file"}',
  });
  expect((await send('PUT', '/api/documents/.claude%2Fx.md', { content: 'x' })).status).toBe(400);
  expect(await Bun.file(join(workspace, 'notes.txt')).exists()).toBe(false);
});

test('refuses a save whose body has no content', async () => {
  const { status, body } = await send('PUT', '/api/documents/notes.md', { text: 'x' });
  expect(status).toBe(400);
  expect(JSON.parse(body)).toEqual({ error: expect.any(String) });
});

test('lists the workspace as folders and markdown files', async () => {
  await mkdir(join(workspace, 'drafts'));
  await writeFile(join(workspace, 'drafts/soil.md'), '# Soil\n');
  expect(await send('GET', '/api/documents')).toEqual({
    status: 200,
    body: JSON.stringify({
      entries: [
        { path: 'drafts', kind: 'folder' },
        { path: 'drafts/soil.md', kind: 'file' },
        { path: 'notes.md', kind: 'file' },
      ],
    }),
  });
});

test('creates a folder, then a folder inside it', async () => {
  expect(await send('POST', '/api/documents/create', { path: 'drafts', kind: 'folder' })).toEqual({ status: 200, body: '{"ok":true}' });
  expect(await send('POST', '/api/documents/create', { path: 'drafts/2026', kind: 'folder' })).toEqual({ status: 200, body: '{"ok":true}' });
  expect(await readdir(join(workspace, 'drafts'))).toEqual(['2026']);
});

test('makes no loose markdown file: a post is made with create-post instead', async () => {
  expect((await send('POST', '/api/documents/create', { path: 'soil.md', kind: 'file' })).status).toBe(400);
  expect(await readdir(workspace)).toEqual(['notes.md']);
});

test('makes a post inside a folder from its working title, and answers with its draft\'s path', async () => {
  await mkdir(join(workspace, 'Essays'));
  expect(await send('POST', '/api/documents/create-post', { parent: 'Essays', title: 'Why I Love: Rust?' })).toEqual({
    status: 200,
    body: '{"path":"Essays/Why I Love Rust/draft.md"}',
  });
  expect(await Bun.file(join(workspace, 'Essays/Why I Love Rust/draft.md')).text()).toBe('# Why I Love: Rust?\n');
});

test('refuses a post whose folder is taken, whose parent is missing, or whose title or body cannot be used', async () => {
  await mkdir(join(workspace, 'Garden'));
  expect(await send('POST', '/api/documents/create-post', { parent: '', title: 'Garden' })).toEqual({
    status: 400,
    body: '{"error":"Garden already exists"}',
  });
  expect(await send('POST', '/api/documents/create-post', { parent: 'Gone', title: 'Hi' })).toEqual({
    status: 404,
    body: '{"error":"Gone was not found"}',
  });
  expect(await send('POST', '/api/documents/create-post', { parent: '', title: '::' })).toEqual({
    status: 400,
    body: '{"error":"\\"::\\" has no characters a folder name can use"}',
  });
  expect((await send('POST', '/api/documents/create-post', { parent: '' })).status).toBe(400);
});

test('refuses to create a taken path, or from a body that is not a path and kind', async () => {
  await mkdir(join(workspace, 'drafts'));
  expect(await send('POST', '/api/documents/create', { path: 'drafts', kind: 'folder' })).toEqual({
    status: 400,
    body: '{"error":"drafts already exists"}',
  });
  expect((await send('POST', '/api/documents/create', { path: 'x.md', kind: 'link' })).status).toBe(400);
  expect((await send('POST', '/api/documents/create', 'not json')).status).toBe(400);
});

test('moves a file, and refuses a move from a missing item or a body without both paths', async () => {
  await mkdir(join(workspace, 'drafts'));
  expect(await send('POST', '/api/documents/move', { from: 'notes.md', to: 'drafts/notes.md' })).toEqual({ status: 200, body: '{"ok":true}' });
  expect(await Bun.file(join(workspace, 'drafts/notes.md')).text()).toBe('# Notes\n');

  expect(await send('POST', '/api/documents/move', { from: 'notes.md', to: 'x.md' })).toEqual({
    status: 404,
    body: '{"error":"notes.md was not found"}',
  });
  expect((await send('POST', '/api/documents/move', { from: 'drafts/notes.md' })).status).toBe(400);
});

test('counts what is inside a folder, then deletes it', async () => {
  await mkdir(join(workspace, 'drafts/2026'), { recursive: true });
  await writeFile(join(workspace, 'drafts/soil.md'), '# Soil\n');
  expect(await send('POST', '/api/documents/count', { path: 'drafts' })).toEqual({ status: 200, body: '{"files":1,"folders":1}' });
  expect(await send('POST', '/api/documents/delete', { path: 'drafts' })).toEqual({ status: 200, body: '{"ok":true}' });
  expect(await send('POST', '/api/documents/delete', { path: 'drafts' })).toEqual({ status: 404, body: '{"error":"drafts was not found"}' });
  expect((await send('POST', '/api/documents/count', {})).status).toBe(400);
});

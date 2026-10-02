import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../../engine/engine';
import { serveTools } from '../chat/mcp-endpoint/mcp-endpoint';
import { documentRoutes } from './documents.routes';

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
  const res = await documentRoutes(createEngine({ workspace, claude: 'api', serveTools }).documents).request(path, {
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

test('creates a folder, then a file inside it', async () => {
  expect(await send('POST', '/api/documents/create', { path: 'drafts', kind: 'folder' })).toEqual({ status: 200, body: '{"ok":true}' });
  expect(await send('POST', '/api/documents/create', { path: 'drafts/soil.md', kind: 'file' })).toEqual({ status: 200, body: '{"ok":true}' });
  expect(await Bun.file(join(workspace, 'drafts/soil.md')).text()).toBe('# soil\n');
});

test('refuses to create a taken path, or from a body that is not a path and kind', async () => {
  expect(await send('POST', '/api/documents/create', { path: 'notes.md', kind: 'file' })).toEqual({
    status: 400,
    body: '{"error":"notes.md already exists"}',
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

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_SKILL_FILES } from '../app-files/app-files';
import { createEngine } from '../engine/engine';
import { createLocalFileSystem } from '../file-system/file-system';
import { createFilePostStore } from '../posts/posts';
import { serveTools, startServer } from './server';

let workspace: string;
let url: URL;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-server-'));
  const fileSystem = createLocalFileSystem(workspace);
  const engine = createEngine({ fileSystem, posts: createFilePostStore(fileSystem), appSkillFiles: APP_SKILL_FILES, env: { ANTHROPIC_API_KEY: 'test' }, isOnPath: () => true, serveTools });
  url = startServer(engine, { port: 0, development: false }).url;
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// A page on another site, or one whose name was rebound to this machine, must not reach the writer's posts.
test('a request naming another host is refused', async () => {
  const res = await fetch(new URL('/api/health', url), { headers: { host: 'evil.example' } });
  expect([res.status, await res.text()]).toEqual([403, 'Forbidden']);
});

test('a request from another site’s page is refused, and the app’s own page and plain requests are served', async () => {
  const from = async (origin?: string) => (await fetch(new URL('/api/health', url), { headers: origin ? { origin } : {} })).status;
  expect(await from('https://evil.example')).toBe(403);
  expect(await from(`http://evil.example:${url.port}`)).toBe(403);
  expect(await from(url.origin)).toBe(200);
  expect(await from()).toBe(200);
});

// Every event carries a chat's session id, which would let another site drive the AI.
test('the event socket refuses another site’s page and opens for the app’s own', async () => {
  const opens = (origin: string) =>
    new Promise<boolean>((resolve) => {
      const socket = new WebSocket(`${url.origin.replace('http', 'ws')}/ws/events`, { headers: { origin } } as unknown as string[]);
      socket.addEventListener('open', () => (socket.close(), resolve(true)));
      socket.addEventListener('error', () => resolve(false));
    });
  expect(await opens('https://evil.example')).toBe(false);
  expect(await opens(url.origin)).toBe(true);
});

// Nothing here asks who is calling, so only this machine may call.
test('the server listens on this machine only', () => {
  expect(url.hostname).toBe('127.0.0.1');
});

test('serves the post routes', async () => {
  const res = await fetch(new URL('/api/posts', url));
  expect([res.status, await res.json()]).toEqual([200, { posts: [] }]);
});

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ViewState } from '../../shared/wire';
import { stateKey } from '../../engine/components/json-file';
import { createEngine } from '../../engine/engine';
import { serveTools } from '../chat/mcp-endpoint/mcp-endpoint';
import { viewStateRoutes } from './view-state.routes';
import { createLocalFileSystem } from '../../file-system/file-system';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-view-state-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// A fresh engine each time, so a second one stands for a restart.
const routes = () => viewStateRoutes(createEngine({ fileSystem: createLocalFileSystem(workspace), claude: 'api', serveTools }).viewState);

test('with nothing stored, answers the empty view', async () => {
  const res = await routes().request('/api/view-state');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ mode: 'rendered', unsaved: [], notApplied: [] });
});

const view: ViewState = {
  current: 'drafts/post.md',
  mode: 'raw',
  unsaved: [{ name: 'drafts/post.md', saved: '# Post\n', doc: 'AQLr3wE=', loadBase: 'AQGa1w==' }],
  highlights: { file: 'drafts/post.md', passages: [{ quote: 'tightened intro' }] },
  notApplied: [{ name: 'ideas.md', message: 'it was saved while the AI was working; ask again' }],
  turn: { file: 'drafts/post.md', bases: { 'drafts/post.md': 'AQKx0w==' } },
  appliedTurn: 'msg-a91c2',
};

const put = (body: unknown) =>
  routes().request('/api/view-state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('a stored view comes back after a restart', async () => {
  const res = await put(view);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const restarted = await routes().request('/api/view-state');
  expect(await restarted.json()).toEqual(view);
});

test('a view that cannot be stored answers 500 with why', async () => {
  // A non-empty folder where the file should be makes the write fail.
  await mkdir(join(join(workspace, stateKey('view.json')), 'blocker'), { recursive: true });
  const res = await put(view);
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: expect.any(String) });
});

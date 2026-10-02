import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../../engine/engine';
import { SRC } from '../../engine/paths';
import { serveTools } from '../chat/mcp-endpoint/mcp-endpoint';
import { workspaceConfigRoutes } from './workspace-config.routes';
import { createLocalFileSystem } from '../../file-system/file-system';

let empty: string;

beforeEach(async () => {
  empty = await mkdtemp(join(tmpdir(), '3pitor-route-'));
});

afterEach(async () => {
  await rm(empty, { recursive: true, force: true });
});

const get = async (workspace: string) => (await workspaceConfigRoutes(createEngine({ fileSystem: createLocalFileSystem(workspace), claude: 'api', serveTools }).workspaceConfig).request('/api/workspace-config')).text();

test('lists the app and fixture workspace skills and agents by name', async () => {
  expect(await get(join(SRC, 'fixtures/workspace'))).toBe('{"skills":["collaborative-editing","doc-stats","proofread","research"],"agents":["proofreader","title-writer"]}');
});

test('lists only the app skills and code agents for a workspace with no .claude folder', async () => {
  expect(await get(empty)).toBe('{"skills":["collaborative-editing","proofread","research"],"agents":["title-writer"]}');
});

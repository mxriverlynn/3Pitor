import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceConfigRoutes } from './workspace-config.routes';
import { SRC } from './workspace';

let empty: string;

beforeEach(async () => {
  empty = await mkdtemp(join(tmpdir(), '3pitor-route-'));
});

afterEach(async () => {
  await rm(empty, { recursive: true, force: true });
});

const get = async (workspace: string) => (await workspaceConfigRoutes(workspace).request('/api/workspace-config')).text();

test('lists the fixture workspace skill and agents by name', async () => {
  expect(await get(join(SRC, 'fixtures/workspace'))).toBe('{"skills":["doc-stats"],"agents":["proofreader","title-writer"]}');
});

test('lists only the code agents for a workspace with no .claude folder', async () => {
  expect(await get(empty)).toBe('{"skills":[],"agents":["title-writer"]}');
});

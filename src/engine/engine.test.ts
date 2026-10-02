import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stubToolServer } from './chat/components/stub-tool-server';
import { scriptedModel, useModel } from './chat/components/test-model';
import { createEngine } from './engine';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-engine-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const { serveTools } = stubToolServer();

// The current session as the page loads it: the chat panel's messages, not the model's, whether a turn is running,
// and how chat reaches Claude.
test('the current session has the chat panel messages, no turn running, and the chat mode', async () => {
  for (const claude of ['api', 'cli'] as const) {
    const engine = createEngine({ workspace, claude, serveTools });
    const id = await engine.sessions.create();
    expect(engine.sessions.current()).toEqual({ id, messages: [], running: false, claude });
  }
});

test('the current session is running from the moment a turn is accepted until its reply is recorded', async () => {
  useModel(scriptedModel('Done.'));
  const engine = createEngine({ workspace, claude: 'api', serveTools });
  const id = await engine.sessions.create();

  const stream = engine.sessions.chat(id, { text: 'Hi' });
  expect(engine.sessions.current()).toMatchObject({ id, running: true, messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }] });

  await Array.fromAsync(stream as unknown as AsyncIterable<unknown>);
  expect(engine.sessions.current()).toMatchObject({ id, running: false });
  expect(engine.sessions.current().messages.map((m) => m.role)).toEqual(['user', 'assistant']);
});

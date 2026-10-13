import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stubToolServer } from './chat/components/stub-tool-server';
import { scriptedModel, useModel } from './chat/components/test-model';
import { APP_SKILL_FILES } from '../app-files/app-files';
import type { ModelChoice } from '../shared/wire';
import { createEngine } from './engine';
import { createLocalFileSystem } from '../file-system/file-system';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-engine-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const { serveTools } = stubToolServer();

// The current session as the page loads it: the chat panel's messages, not the model's, whether a turn is running,
// and the model it uses, with the labels the header shows.
test('the current session has the chat panel messages, no turn running, and its model with the header labels', async () => {
  const engine = createEngine({ fileSystem: createLocalFileSystem(workspace), appSkillFiles: APP_SKILL_FILES, env: { ANTHROPIC_API_KEY: 'test' }, isOnPath: () => true, serveTools });
  const id = (await engine.sessions.create()).id;
  const model: ModelChoice = { provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium', providerLabel: 'Claude', modelLabel: 'Haiku 5.5', access: 'api' };
  expect(engine.sessions.current()).toEqual({ id, messages: [], running: false, model });
});

test('the current session is running from the moment a turn is accepted until its reply is recorded', async () => {
  useModel(scriptedModel('Done.'));
  const engine = createEngine({ fileSystem: createLocalFileSystem(workspace), appSkillFiles: APP_SKILL_FILES, env: { ANTHROPIC_API_KEY: 'test' }, isOnPath: () => true, serveTools });
  const id = (await engine.sessions.create()).id;

  const stream = engine.sessions.chat(id, { text: 'Hi' });
  expect(engine.sessions.current()).toMatchObject({ id, running: true, messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }] });

  await Array.fromAsync(stream as unknown as AsyncIterable<unknown>);
  expect(engine.sessions.current()).toMatchObject({ id, running: false });
  expect(engine.sessions.current().messages.map((m) => m.role)).toEqual(['user', 'assistant']);
});

// The app's skills come from the map the host hands in, all the way to the model's Read tool.
test('a chat turn reads an app skill file from the appSkillFiles the engine was given', async () => {
  const appSkillFiles = { 'proofread/SKILL.md': '---\ndescription: Stand-in\n---\nThe stand-in proofread skill.\n' };
  const model = scriptedModel([{ tool: 'Read', input: { file_path: '3pitor://skills/proofread/SKILL.md' } }], 'Done.');
  useModel(model);
  const engine = createEngine({ fileSystem: createLocalFileSystem(workspace), appSkillFiles, env: { ANTHROPIC_API_KEY: 'test' }, isOnPath: () => true, serveTools });
  const id = (await engine.sessions.create()).id;
  await Array.fromAsync(engine.sessions.chat(id, { text: 'Proofread' }) as unknown as AsyncIterable<unknown>);
  const toolMessage = model.doStreamCalls[1].prompt.find((m) => m.role === 'tool');
  expect(JSON.stringify(toolMessage)).toContain('The stand-in proofread skill.');
});

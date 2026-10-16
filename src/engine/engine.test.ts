import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stubToolServer } from './chat/components/stub-tool-server';
import { scriptedModel, useModel } from './chat/components/test-model';
import { APP_SKILL_FILES } from '../app-files/app-files';
import type { ModelChoice } from '../shared/wire';
import { createEngine, startEngine } from './engine';
import { createLocalFileSystem } from '../file-system/file-system';
import { createFilePostStore } from '../posts/posts';

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
  const engine = createEngine({ fileSystem: createLocalFileSystem(workspace), posts: createFilePostStore(createLocalFileSystem(workspace)), appSkillFiles: APP_SKILL_FILES, env: { ANTHROPIC_API_KEY: 'test' }, isOnPath: () => true, serveTools });
  const id = (await engine.sessions.create()).id;
  const model: ModelChoice = { provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium', providerLabel: 'Claude', modelLabel: 'Haiku 5.5', access: 'api' };
  expect(engine.sessions.current()).toEqual({ id, messages: [], running: false, model });
});

test('the current session is running from the moment a turn is accepted until its reply is recorded', async () => {
  useModel(scriptedModel('Done.'));
  const engine = createEngine({ fileSystem: createLocalFileSystem(workspace), posts: createFilePostStore(createLocalFileSystem(workspace)), appSkillFiles: APP_SKILL_FILES, env: { ANTHROPIC_API_KEY: 'test' }, isOnPath: () => true, serveTools });
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
  const engine = createEngine({ fileSystem: createLocalFileSystem(workspace), posts: createFilePostStore(createLocalFileSystem(workspace)), appSkillFiles, env: { ANTHROPIC_API_KEY: 'test' }, isOnPath: () => true, serveTools });
  const id = (await engine.sessions.create()).id;
  await Array.fromAsync(engine.sessions.chat(id, { text: 'Proofread' }) as unknown as AsyncIterable<unknown>);
  const toolMessage = model.doStreamCalls[1].prompt.find((m) => m.role === 'tool');
  expect(JSON.stringify(toolMessage)).toContain('The stand-in proofread skill.');
});

// The server reaches posts only through the engine, which hands on the store the host built.
test('the engine serves posts from the store it was given', async () => {
  const fileSystem = createLocalFileSystem(workspace);
  const posts = createFilePostStore(fileSystem);
  const id = await posts.create({ title: 'The Sun', body: 'It rises.' });
  const engine = createEngine({ fileSystem, posts, appSkillFiles: APP_SKILL_FILES, env: { ANTHROPIC_API_KEY: 'test' }, isOnPath: () => true, serveTools });
  expect(await engine.posts.get(id)).toEqual({ id, title: 'The Sun', body: 'It rises.' });
});

// What startEngine printed, kept out of the test output.
async function startupOutput(env: Record<string, string | undefined>) {
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await startEngine({ fileSystem: createLocalFileSystem(workspace), posts: createFilePostStore(createLocalFileSystem(workspace)), appSkillFiles: APP_SKILL_FILES, env, isOnPath: () => true, serveTools });
    return { logged: log.mock.calls.flat(), warned: warn.mock.calls.flat() };
  } finally {
    log.mockRestore();
    warn.mockRestore();
  }
}

test('startup names the provider, whether it is local, the model, and the thinking level the current chat will use', async () => {
  expect((await startupOutput({ ANTHROPIC_API_KEY: 'test' })).logged).toEqual(['3pitor chat: Claude (API) · claude-haiku-5-5 · medium thinking']);
  expect((await startupOutput({})).logged).toEqual(['3pitor chat: Claude (Local) · claude-haiku-5-5 · medium thinking']);
});

test('startup warns that MODEL is no longer read, when it is set', async () => {
  expect((await startupOutput({ ANTHROPIC_API_KEY: 'test', MODEL: 'opus' })).warned).toEqual(['3pitor: MODEL is no longer read. Choose the model from New chat.']);
  expect((await startupOutput({ ANTHROPIC_API_KEY: 'test' })).warned).toEqual([]);
});

test('the model catalog lists every provider in order, with its models and what stops it working, and the saved selection', async () => {
  const env = { ANTHROPIC_API_KEY: 'test', OLLAMA_HOST: 'http://127.0.0.1:1' };
  const engine = createEngine({ fileSystem: createLocalFileSystem(workspace), posts: createFilePostStore(createLocalFileSystem(workspace)), appSkillFiles: APP_SKILL_FILES, env, isOnPath: () => true, serveTools });
  const catalog = await engine.models.list();

  expect(catalog.providers.map((p) => [p.id, p.label, p.access, p.problem !== undefined, p.models.length])).toEqual([
    ['claude-cli', 'Claude', 'local', false, 4],
    ['claude-api', 'Claude', 'api', false, 4],
    ['openai', 'OpenAI', 'api', true, 3],
    ['google', 'Google Gemini', 'api', true, 4],
    ['ollama', 'Ollama', 'local', true, 0],
  ]);
  expect(catalog.providers[4]!.problem).toBe('Ollama is not running at http://127.0.0.1:1');
  expect(catalog.selected).toEqual({ provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium' });

  await engine.sessions.create({ provider: 'openai', model: 'gpt-6-luna', thinking: 'low' });
  expect((await engine.models.list()).selected).toEqual({ provider: 'openai', model: 'gpt-6-luna', thinking: 'low' });
});

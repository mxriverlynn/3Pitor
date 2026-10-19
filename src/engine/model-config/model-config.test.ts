import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFileSystem, type FileSystem } from '../../file-system/file-system';
import { stubToolServer } from '../components/stub-tool-server';
import { providerBackends } from '../chat/providers/providers';
import { defaultSelection, fitsCatalog, loadSelection, parseSelection, saveSelection } from './model-config';

let workspace: string;
let fileSystem: FileSystem;
const backends = providerBackends(stubToolServer().serveTools);

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-model-config-'));
  fileSystem = createLocalFileSystem(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test('the default is Haiku 5.5 on medium thinking, through the API when there is a key and the claude program when not', () => {
  expect(defaultSelection({ ANTHROPIC_API_KEY: 'sk-ant-test' })).toEqual({ provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium' });
  expect(defaultSelection({})).toEqual({ provider: 'claude-cli', model: 'claude-haiku-5-5', thinking: 'medium' });
  expect(defaultSelection({ ANTHROPIC_API_KEY: '' })).toEqual({ provider: 'claude-cli', model: 'claude-haiku-5-5', thinking: 'medium' });
});

test('a selection names a known provider and a model, and a thinking level only when it is one of the five', () => {
  expect(parseSelection({ provider: 'claude-cli', model: 'claude-opus-5-5', thinking: 'high' })).toEqual({ provider: 'claude-cli', model: 'claude-opus-5-5', thinking: 'high' });
  expect(parseSelection({ provider: 'claude-api', model: 'claude-opus-5-5' })).toEqual({ provider: 'claude-api', model: 'claude-opus-5-5' });
  expect(parseSelection({ provider: 'mistral', model: 'x' })).toBeUndefined();
  expect(parseSelection({ provider: 'claude-api', model: '' })).toBeUndefined();
  expect(parseSelection({ provider: 'claude-api', model: 'claude-opus-5-5', thinking: 'turbo' })).toBeUndefined();
  expect(parseSelection({ provider: 'claude-api' })).toBeUndefined();
  expect(parseSelection('claude-api')).toBeUndefined();
  expect(parseSelection(null)).toBeUndefined();
});

test('a selection keeps only its three fields', () => {
  expect(parseSelection({ provider: 'claude-api', model: 'claude-opus-5-5', thinking: 'low', extra: 1 })).toEqual({ provider: 'claude-api', model: 'claude-opus-5-5', thinking: 'low' });
});

test('a selection fits when its model is listed and its level is one that model offers, or when an unlisted model has no level', () => {
  expect(fitsCatalog({ provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'max' }, backends)).toBe(true);
  expect(fitsCatalog({ provider: 'claude-cli', model: 'claude-haiku-5-5' }, backends)).toBe(true);
  expect(fitsCatalog({ provider: 'claude-api', model: 'claude-sonnet-5' }, backends)).toBe(true);
  expect(fitsCatalog({ provider: 'claude-api', model: 'claude-sonnet-5', thinking: 'high' }, backends)).toBe(false);
});

// What `call` warned with console.warn, kept out of the test output.
async function warned<T>(call: () => Promise<T>): Promise<{ result: T; warnings: unknown[][] }> {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return { result: await call(), warnings: warn.mock.calls };
  } finally {
    warn.mockRestore();
  }
}

test('with no config file, a chat uses the default, and nothing is said about it', async () => {
  const { result, warnings } = await warned(() => loadSelection(fileSystem, { ANTHROPIC_API_KEY: 'k' }, backends));
  expect(result).toEqual({ provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium' });
  expect(warnings).toEqual([]);
});

// Writes .3pitor/config.json as the operator might have left it.
async function writeConfig(content: unknown) {
  await mkdir(join(workspace, '.3pitor'), { recursive: true });
  await writeFile(join(workspace, '.3pitor', 'config.json'), typeof content === 'string' ? content : JSON.stringify(content));
}

test('a saved selection that fits is the one a chat uses', async () => {
  await writeConfig({ selectedModel: { provider: 'claude-cli', model: 'claude-opus-5-5', thinking: 'high' }, theme: 'dark' });
  const { result, warnings } = await warned(() => loadSelection(fileSystem, {}, backends));
  expect(result).toEqual({ provider: 'claude-cli', model: 'claude-opus-5-5', thinking: 'high' });
  expect(warnings).toEqual([]);
});

test('a saved selection that is not usable falls back to the default, with a warning saying why and what is used instead', async () => {
  await writeConfig({ selectedModel: { provider: 'mistral', model: 'x' } });
  const unknown = await warned(() => loadSelection(fileSystem, {}, backends));
  expect(unknown.result).toEqual(defaultSelection({}));
  expect(unknown.warnings).toEqual([[
    '3pitor: ignoring selectedModel in .3pitor/config.json (it must name a known provider, a model, and a thinking level); using claude-cli claude-haiku-5-5',
  ]]);

  await writeConfig({ selectedModel: { provider: 'claude-api', model: 'claude-sonnet-5', thinking: 'high' } });
  const unoffered = await warned(() => loadSelection(fileSystem, {}, backends));
  expect(unoffered.result).toEqual(defaultSelection({}));
  expect(unoffered.warnings).toEqual([[
    '3pitor: ignoring selectedModel in .3pitor/config.json (claude-sonnet-5 does not offer high thinking); using claude-cli claude-haiku-5-5',
  ]]);
});

const configOnDisk = async () => JSON.parse(await readFile(join(workspace, '.3pitor', 'config.json'), 'utf8'));

test('saving a selection replaces selectedModel and keeps every other setting in the file', async () => {
  await writeConfig({ selectedModel: { provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium' }, theme: 'dark' });
  await saveSelection(fileSystem, { provider: 'claude-cli', model: 'claude-opus-5-5' });
  expect(await configOnDisk()).toEqual({ selectedModel: { provider: 'claude-cli', model: 'claude-opus-5-5' }, theme: 'dark' });
});

test('saving over a config file that is not a JSON object starts the file afresh', async () => {
  const selection = { provider: 'claude-cli' as const, model: 'claude-opus-5-5' };
  for (const content of [['a', 'b'], '"just text"', '{ not json']) {
    await writeConfig(content);
    await warned(() => saveSelection(fileSystem, selection));
    expect(await configOnDisk()).toEqual({ selectedModel: selection });
  }
});

test('OpenAI, Gemini, and Ollama selections read like Claude ones, and a level the model does not offer does not fit', () => {
  const luna = { provider: 'openai', model: 'gpt-6-luna', thinking: 'high' } as const;
  expect(parseSelection(luna)).toEqual(luna);
  expect(parseSelection({ provider: 'google', model: 'gemini-3.8-flash' })).toEqual({ provider: 'google', model: 'gemini-3.8-flash' });
  expect(parseSelection({ provider: 'ollama', model: 'llama3.2:latest' })).toEqual({ provider: 'ollama', model: 'llama3.2:latest' });
  expect(fitsCatalog(luna, backends)).toBe(true);
  expect(fitsCatalog({ ...luna, thinking: 'max' }, backends)).toBe(false);
  expect(fitsCatalog({ provider: 'ollama', model: 'qwen3:8b' }, backends)).toBe(true);
  expect(fitsCatalog({ provider: 'ollama', model: 'qwen3:8b', thinking: 'high' }, backends)).toBe(false);
});

import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFileSystem, type FileSystem } from '../../file-system/file-system';
import { stubToolServer } from '../chat/components/stub-tool-server';
import { providerBackends } from '../chat/providers/providers';
import { defaultSelection, fitsCatalog, parseSelection } from './model-config';

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

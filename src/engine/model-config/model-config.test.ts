import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFileSystem, type FileSystem } from '../../file-system/file-system';
import { stubToolServer } from '../chat/components/stub-tool-server';
import { providerBackends } from '../chat/providers/providers';
import { defaultSelection } from './model-config';

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

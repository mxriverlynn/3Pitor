import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateText, streamText } from 'ai';
import { claudeCliModel } from './claude-cli';

// A folder holding the fake as `claude`. It is copied and made runnable here, so the test never depends on the file's
// mode in git.
let fakeBin: string;
const saved = { PATH: process.env.PATH, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN };

beforeAll(async () => {
  fakeBin = await mkdtemp(join(tmpdir(), '3pitor-fake-claude-'));
  await copyFile(join(import.meta.dir, 'fake-claude.ts'), join(fakeBin, 'claude'));
  await chmod(join(fakeBin, 'claude'), 0o755);
});

afterAll(async () => {
  await rm(fakeBin, { recursive: true, force: true });
});

// The fake's first line, #!/usr/bin/env bun, needs the running bun on PATH too.
beforeEach(() => {
  process.env.PATH = [fakeBin, dirname(process.execPath)].join(':');
});

afterEach(() => {
  Object.assign(process.env, saved);
  for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name];
});

const model = () => claudeCliModel('claude-sonnet-5', {}, { webTools: true });

test('streams what claude says as the model’s text', async () => {
  const result = streamText({ model: model(), prompt: 'Hi' });
  expect(await result.text).toEndWith(' hello');
});

test('claude runs on the subscription, never on API credentials 3pitor was started with', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.ANTHROPIC_AUTH_TOKEN = 'token';
  const result = streamText({ model: model(), prompt: 'Hi' });
  expect(await result.text).toBe('ANTHROPIC_API_KEY=absent ANTHROPIC_AUTH_TOKEN=absent hello');
});

test('generateText gets claude’s whole reply, as a Task subagent does', async () => {
  const result = await generateText({ model: model(), prompt: 'Hi' });
  expect(result.text).toBe('ANTHROPIC_API_KEY=absent ANTHROPIC_AUTH_TOKEN=absent hello');
  expect(result.finishReason).toBe('stop');
});

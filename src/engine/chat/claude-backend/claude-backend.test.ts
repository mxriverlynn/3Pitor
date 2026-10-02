import { expect, spyOn, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { generateText, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { CLAUDE_NOT_FOUND_HELP } from '../claude-cli/claude-cli';
import { fakeClaudeOnPath } from '../components/fake-claude-on-path';
import { scriptedModel, useModel } from '../components/test-model';
import { stubToolServer } from '../components/stub-tool-server';
import { MISSING_API_KEY_HELP, apiBackend, claudeBackend, cliBackend } from './claude-backend';

fakeClaudeOnPath();

const cli = cliBackend(stubToolServer().serveTools);

test('each mode has its backend, which names how chat reaches Claude', () => {
  const { serveTools } = stubToolServer();
  expect(claudeBackend('api', serveTools)).toBe(apiBackend);
  expect([claudeBackend('cli', serveTools).mode, claudeBackend('cli', serveTools).label]).toEqual(['cli', 'the claude program']);
  expect([apiBackend.mode, apiBackend.label]).toEqual(['api', 'the Anthropic API']);
  expect([cli.mode, cli.label]).toEqual(['cli', 'the claude program']);
});

test('the API backend warns at startup when there is no API key, or an empty one', () => {
  expect(apiBackend.startupWarning({})).toBe(MISSING_API_KEY_HELP);
  expect(apiBackend.startupWarning({ ANTHROPIC_API_KEY: '' })).toBe(MISSING_API_KEY_HELP);
  expect(apiBackend.startupWarning({ ANTHROPIC_API_KEY: 'sk-ant-test' })).toBeUndefined();
  expect(MISSING_API_KEY_HELP).toStartWith("ANTHROPIC_API_KEY is not set, so chat won't work.");
});

test('the missing-key help names the installed 3pitor command, which works without a clone of the repo', () => {
  expect(MISSING_API_KEY_HELP).toEndWith('\n  ANTHROPIC_API_KEY=sk-ant-... 3pitor');
  expect(MISSING_API_KEY_HELP).not.toContain('bun run');
});

test('the CLI backend warns at startup when there is no claude on the PATH it is given', async () => {
  const bin = await mkdtemp(join(tmpdir(), '3pitor-which-'));
  try {
    expect(cli.startupWarning({ PATH: bin })).toBe(CLAUDE_NOT_FOUND_HELP);
    await writeFile(join(bin, 'claude'), '#!/bin/sh\n');
    await chmod(join(bin, 'claude'), 0o755);
    expect(cli.startupWarning({ PATH: bin })).toBeUndefined();
  } finally {
    await rm(bin, { recursive: true, force: true });
  }
});

test('the API backend uses Anthropic’s model for chat and subagents, asks it to cache, and Anthropic runs its web tools', async () => {
  const model = scriptedModel('chat', 'subagent');
  useModel(model);
  await generateText({ model: apiBackend.chatModel('claude-sonnet-5', {}), prompt: 'Hi' });
  await generateText({ model: apiBackend.subagentModel('claude-sonnet-5', {}), prompt: 'Hi' });
  const cache = { anthropic: { cacheControl: { type: 'ephemeral' } } };
  expect(model.doGenerateCalls.map((call) => call.providerOptions)).toEqual([cache, cache]);
  const tools = apiBackend.providerTools();
  expect(Object.keys(tools)).toEqual(['web_search', 'web_fetch']);
  expect([tools.web_search, tools.web_fetch]).toMatchObject([
    { type: 'provider', id: 'anthropic.web_search_20250305', args: { maxUses: 10 } },
    { type: 'provider', id: 'anthropic.web_fetch_20250910', args: { maxUses: 10 } },
  ]);
});

// What `call` printed with console.log, kept out of the test output.
async function logged(call: () => PromiseLike<unknown>) {
  const log = spyOn(console, 'log').mockImplementation(() => {});
  try {
    await call();
    return log.mock.calls;
  } finally {
    log.mockRestore();
  }
}

// The cache line a call to `model` prints.
const cacheLine = (model: LanguageModelV4, counts: string) => `3pitor: cache ${model.provider} ${model.modelId}: ${counts}`;

test('a streamed call prints its cache read and write counts once, when it finishes', async () => {
  useModel(scriptedModel('ok'));
  const model = apiBackend.chatModel('claude-sonnet-5', {});
  expect(await logged(() => streamText({ model, prompt: 'Hi' }).consumeStream())).toEqual([[cacheLine(model, 'read 0, write 0')]]);
});

test('a generated call prints its cache read and write counts once, when it returns', async () => {
  useModel(scriptedModel('ok'));
  const model = apiBackend.subagentModel('claude-sonnet-5', {});
  expect(await logged(() => generateText({ model, prompt: 'Hi' }))).toEqual([[cacheLine(model, 'read 0, write 0')]]);
});

test('a count the model did not report prints as -, so it is not mistaken for a real zero', async () => {
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  const finishReason = { unified: 'stop' as const, raw: 'end_turn' };
  useModel(new MockLanguageModelV4({ doGenerate: async () => ({ content: [], finishReason, usage, warnings: [] }) }));
  const model = apiBackend.chatModel('claude-sonnet-5', {});
  expect(await logged(() => generateText({ model, prompt: 'Hi' }))).toEqual([[cacheLine(model, 'read -, write -')]]);
});

// The --tools the fake claude was started with.
async function toolsFlag(model: Parameters<typeof generateText>[0]['model']) {
  const { args } = JSON.parse((await generateText({ model, prompt: 'echo args' })).text) as { args: string[] };
  return args[args.indexOf('--tools') + 1];
}

test('the CLI backend runs claude for chat with its own web tools, and for subagents with none, as subagents only read', async () => {
  const chat = cli.chatModel('claude-sonnet-5', {});
  expect([chat.provider, chat.modelId]).toEqual(['claude-cli', 'claude-sonnet-5']);
  expect(await toolsFlag(chat)).toBe('WebSearch,WebFetch');
  expect(await toolsFlag(cli.subagentModel('claude-sonnet-5', {}))).toBe('');
  expect(cli.providerTools()).toEqual({});
});

test('calls through the claude program print their cache counts too, for chat and subagents', async () => {
  const chat = cli.chatModel('claude-sonnet-5', {});
  const subagent = cli.subagentModel('claude-sonnet-5', {});
  const line = cacheLine(chat, 'read 0, write 0');
  expect(line).toBe('3pitor: cache claude-cli claude-sonnet-5: read 0, write 0');
  expect(await logged(() => streamText({ model: chat, prompt: 'Hi' }).consumeStream())).toEqual([[line]]);
  expect(await logged(() => generateText({ model: subagent, prompt: 'Hi' }))).toEqual([[line]]);
});

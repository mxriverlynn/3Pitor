import { expect, spyOn, test } from 'bun:test';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { generateText, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { CLAUDE_NOT_FOUND_HELP } from '../claude-cli/claude-cli';
import { fakeClaudeOnPath } from '../components/fake-claude-on-path';
import { scriptedModel, useModel } from '../components/test-model';
import { stubToolServer } from '../components/stub-tool-server';
import type { ThinkingLevel } from '../../../shared/wire';
import { MISSING_API_KEY_HELP, apiBackend, claudeBackend, cliBackend, providerBackends } from './providers';

fakeClaudeOnPath();

const cli = cliBackend(stubToolServer().serveTools);

test('each mode has its backend, by provider id,, which names how chat reaches Claude', () => {
  const { serveTools } = stubToolServer();
  expect(claudeBackend('api', serveTools)).toBe(apiBackend);
  expect([claudeBackend('cli', serveTools).id, claudeBackend('cli', serveTools).label]).toEqual(['claude-cli', 'the claude program']);
  expect([apiBackend.id, apiBackend.label]).toEqual(['claude-api', 'the Anthropic API']);
  expect([cli.id, cli.label]).toEqual(['claude-cli', 'the claude program']);
});

test('providerBackends has a backend per provider, keyed by its id, in the order the picker lists them', () => {
  const backends = providerBackends(stubToolServer().serveTools);
  expect(Object.keys(backends)).toEqual(['claude-cli', 'claude-api']);
  expect(Object.entries(backends).map(([key, backend]) => [key, backend.id])).toEqual([['claude-cli', 'claude-cli'], ['claude-api', 'claude-api']]);
  expect(backends['claude-api']).toBe(apiBackend);
});

test('the claude program runs locally, and the Anthropic API is reached over the network', () => {
  expect(cli.access).toBe('local');
  expect(apiBackend.access).toBe('api');
});

test('both Claude backends offer the four current Claude models, each with five thinking levels, and list them as their models', async () => {
  const levels: ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
  const claudeModels = [
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', thinking: levels },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', thinking: levels },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', thinking: levels },
    { id: 'claude-fable-5-1', label: 'Fable 5.1', thinking: levels },
  ];
  for (const backend of [cli, apiBackend]) {
    expect(backend.catalog).toEqual(claudeModels);
    expect(await backend.models({})).toEqual(claudeModels);
  }
});

test('the API backend warns at startup when there is no API key, or an empty one', () => {
  const isOnPath = () => true;
  expect(apiBackend.problem({}, isOnPath)).toBe(MISSING_API_KEY_HELP);
  expect(apiBackend.problem({ ANTHROPIC_API_KEY: '' }, isOnPath)).toBe(MISSING_API_KEY_HELP);
  expect(apiBackend.problem({ ANTHROPIC_API_KEY: 'sk-ant-test' }, isOnPath)).toBeUndefined();
  expect(MISSING_API_KEY_HELP).toStartWith("ANTHROPIC_API_KEY is not set, so chat won't work.");
});

test('the missing-key help names the installed 3pitor command, which works without a clone of the repo', () => {
  expect(MISSING_API_KEY_HELP).toEndWith('\n  ANTHROPIC_API_KEY=sk-ant-... 3pitor');
  expect(MISSING_API_KEY_HELP).not.toContain('bun run');
});

// A lookup that records what it is asked and answers `found`.
function stubLookup(found: boolean) {
  const calls: [string, string][] = [];
  const isOnPath = (program: string, path: string) => {
    calls.push([program, path]);
    return found;
  };
  return { calls, isOnPath };
}

test('the CLI backend asks the lookup for claude on the PATH it is given, or on "" when there is none', () => {
  const lookup = stubLookup(true);
  cli.problem({ PATH: '/opt/bin:/usr/bin' }, lookup.isOnPath);
  cli.problem({}, lookup.isOnPath);
  expect(lookup.calls).toEqual([['claude', '/opt/bin:/usr/bin'], ['claude', '']]);
});

test('the CLI backend warns at startup only when the lookup does not find claude', () => {
  expect(cli.problem({ PATH: '/opt/bin' }, stubLookup(false).isOnPath)).toBe(CLAUDE_NOT_FOUND_HELP);
  expect(cli.problem({ PATH: '/opt/bin' }, stubLookup(true).isOnPath)).toBeUndefined();
});

test('the API backend never asks the lookup', () => {
  const lookup = stubLookup(false);
  apiBackend.problem({ ANTHROPIC_API_KEY: 'sk-ant-test' }, lookup.isOnPath);
  apiBackend.problem({}, lookup.isOnPath);
  expect(lookup.calls).toEqual([]);
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

test('an API chat model built with a thinking level asks Anthropic for that effort, beside the cache setting', async () => {
  const model = scriptedModel('chat');
  useModel(model);
  await generateText({ model: apiBackend.chatModel('claude-opus-5-5', {}, 'medium'), prompt: 'Hi' });
  expect(model.doGenerateCalls[0]!.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' }, effort: 'medium' } });
});

test('API models ask for 128,000 output tokens, the most every listed Claude model allows, so a model the package does not know yet is not capped', async () => {
  const model = scriptedModel('chat', 'subagent');
  useModel(model);
  await generateText({ model: apiBackend.chatModel('claude-haiku-5-5', {}), prompt: 'Hi' });
  await generateText({ model: apiBackend.subagentModel('claude-haiku-5-5', {}), prompt: 'Hi' });
  expect(model.doGenerateCalls.map((call) => call.maxOutputTokens)).toEqual([128000, 128000]);
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

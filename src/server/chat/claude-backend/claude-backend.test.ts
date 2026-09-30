import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { generateText } from 'ai';
import { CLAUDE_NOT_FOUND_HELP } from '../claude-cli/claude-cli';
import { fakeClaudeOnPath } from '../claude-cli/fake-claude-on-path';
import { scriptedModel, useModel } from '../components/test-model';
import { MISSING_API_KEY_HELP, apiBackend, claudeBackend, cliBackend } from './claude-backend';

fakeClaudeOnPath();

test('each mode has its backend, which names how chat reaches Claude', () => {
  expect(claudeBackend('api')).toBe(apiBackend);
  expect(claudeBackend('cli')).toBe(cliBackend);
  expect([apiBackend.mode, apiBackend.label]).toEqual(['api', 'the Anthropic API']);
  expect([cliBackend.mode, cliBackend.label]).toEqual(['cli', 'the claude program']);
});

test('the API backend warns at startup when there is no API key, or an empty one', () => {
  expect(apiBackend.startupWarning({})).toBe(MISSING_API_KEY_HELP);
  expect(apiBackend.startupWarning({ ANTHROPIC_API_KEY: '' })).toBe(MISSING_API_KEY_HELP);
  expect(apiBackend.startupWarning({ ANTHROPIC_API_KEY: 'sk-ant-test' })).toBeUndefined();
  expect(MISSING_API_KEY_HELP).toStartWith("ANTHROPIC_API_KEY is not set, so chat won't work.");
});

test('the CLI backend warns at startup when there is no claude on the PATH it is given', async () => {
  const bin = await mkdtemp(join(tmpdir(), '3pitor-which-'));
  try {
    expect(cliBackend.startupWarning({ PATH: bin })).toBe(CLAUDE_NOT_FOUND_HELP);
    await writeFile(join(bin, 'claude'), '#!/bin/sh\n');
    await chmod(join(bin, 'claude'), 0o755);
    expect(cliBackend.startupWarning({ PATH: bin })).toBeUndefined();
  } finally {
    await rm(bin, { recursive: true, force: true });
  }
});

test('the API backend uses Anthropic’s model for chat and subagents, and Anthropic runs its web tools', () => {
  const model = scriptedModel();
  useModel(model);
  expect(apiBackend.chatModel('claude-sonnet-5', {})).toBe(model);
  expect(apiBackend.subagentModel('claude-sonnet-5', {})).toBe(model);
  const tools = apiBackend.providerTools();
  expect(Object.keys(tools)).toEqual(['web_search', 'web_fetch']);
  expect([tools.web_search, tools.web_fetch]).toMatchObject([
    { type: 'provider', id: 'anthropic.web_search_20250305', args: { maxUses: 10 } },
    { type: 'provider', id: 'anthropic.web_fetch_20250910', args: { maxUses: 10 } },
  ]);
});

// The --tools the fake claude was started with.
async function toolsFlag(model: Parameters<typeof generateText>[0]['model']) {
  const { args } = JSON.parse((await generateText({ model, prompt: 'echo args' })).text) as { args: string[] };
  return args[args.indexOf('--tools') + 1];
}

test('the CLI backend runs claude for chat with its own web tools, and for subagents with none, as subagents only read', async () => {
  const chat = cliBackend.chatModel('claude-sonnet-5', {}) as LanguageModelV4;
  expect([chat.provider, chat.modelId]).toEqual(['claude-cli', 'claude-sonnet-5']);
  expect(await toolsFlag(chat)).toBe('WebSearch,WebFetch');
  expect(await toolsFlag(cliBackend.subagentModel('claude-sonnet-5', {}))).toBe('');
  expect(cliBackend.providerTools()).toEqual({});
});

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { chmod, copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateText, streamText } from 'ai';
import { editedTexts, fileTools, turnTexts } from '../tools/tools';
import { CLAUDE_NOT_FOUND_HELP, claudeCliModel } from './claude-cli';

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

// What the fake saw: its arguments and its working folder.
const invocation = async (options: Omit<Parameters<typeof generateText>[0], 'model'>, webTools = true) => {
  const result = await generateText({ model: claudeCliModel('claude-sonnet-5', {}, { webTools }), ...options } as Parameters<typeof generateText>[0]);
  return JSON.parse(result.text) as { args: string[]; cwd: string; mcpToolTimeout?: string };
};
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test('the system messages become claude’s system prompt, and a lone user message goes to stdin as it is', async () => {
  const { args } = await invocation({ system: 'Be brief.', prompt: 'echo args' });
  expect(after(args, '--system-prompt')).toBe('Be brief.');
  expect((await generateText({ model: model(), system: 'Be brief.', prompt: 'echo stdin' })).text).toBe('echo stdin');
});

test('earlier messages go to stdin as a transcript, followed by the new message', async () => {
  const result = await generateText({
    model: model(),
    system: 'Be brief.',
    messages: [
      { role: 'user', content: 'Summarize a.md' },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I should read it first.' },
          { type: 'text', text: 'I’ll read it.' },
          { type: 'tool-call', toolCallId: 'c1', toolName: 'Read', input: { file_path: 'a.md' } },
          { type: 'tool-call', toolCallId: 'c2', toolName: 'Glob', input: { pattern: '*.md' } },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'c1', toolName: 'Read', output: { type: 'text', value: '# A\nFirst post.' } },
          { type: 'tool-result', toolCallId: 'c2', toolName: 'Glob', output: { type: 'json', value: ['a.md'] } },
        ],
      },
      { role: 'assistant', content: 'A is the first post.' },
      { role: 'user', content: 'echo stdin' },
    ],
  });
  expect(result.text).toBe(
    [
      '<history>',
      '<message role="user">',
      'Summarize a.md',
      '</message>',
      '<message role="assistant">',
      'I’ll read it.',
      '[tool call Read {"file_path":"a.md"}]',
      '[tool call Glob {"pattern":"*.md"}]',
      '</message>',
      '<message role="tool">',
      '[tool result Read] # A',
      'First post.',
      '[tool result Glob] ["a.md"]',
      '</message>',
      '<message role="assistant">',
      'A is the first post.',
      '</message>',
      '</history>',
      '',
      '<message role="user">',
      'echo stdin',
      '</message>',
    ].join('\n'),
  );
});

test('claude runs from a neutral folder with only its web tools, and none of the operator’s settings, skills, or MCP servers', async () => {
  const seen = await invocation({ system: 'Be brief.', prompt: 'echo args' });
  expect(seen.args).toEqual([
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--input-format', 'text',
    '--model', 'claude-sonnet-5', '--system-prompt', 'Be brief.', '--no-session-persistence',
    '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config',
    '--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch',
  ]);
  expect(seen.cwd).toBe(await realpath(tmpdir()));
  // claude gives up on an MCP tool call after about a minute otherwise, and a Task call can take longer.
  expect(seen.mcpToolTimeout).toBe('86400000');
});

test('a subagent’s claude gets no tools of its own at all', async () => {
  const { args } = await invocation({ prompt: 'echo args' }, false);
  expect(after(args, '--tools')).toBe('');
  expect(args).not.toContain('--allowedTools');
});

// A workspace with notes.md on disk and a different, unsaved copy of it in the browser.
async function withWorkspace(run: (workspace: string, turn: ReturnType<typeof turnTexts>) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), '3pitor-claude-cli-'));
  try {
    await writeFile(join(workspace, 'notes.md'), '# Notes\n');
    await run(workspace, turnTexts(workspace, { 'notes.md': '# Notes typed but not saved\n' }));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

test('claude’s tool calls run in 3pitor against the turn’s copy, and show as tool rows the AI SDK does not run again', async () => {
  await withWorkspace(async (workspace, turn) => {
    const tools = fileTools(workspace, turn);
    const result = streamText({
      model: claudeCliModel('claude-sonnet-5', tools, { webTools: true }),
      tools,
      prompt: 'call Edit {"file_path":"notes.md","old_string":"typed","new_string":"written"}',
    });
    const parts = (await Array.fromAsync(result.fullStream as unknown as AsyncIterable<{ type: string }>)).filter(
      (p) => p.type === 'tool-call' || p.type === 'tool-result',
    );

    expect(parts).toMatchObject([
      { type: 'tool-call', toolName: 'Edit', providerExecuted: true, input: { file_path: 'notes.md' } },
      { type: 'tool-result', toolName: 'Edit', providerExecuted: true },
    ]);
    expect(await result.text).toStartWith('edited notes.md');
    expect(editedTexts(turn)).toEqual({ 'notes.md': '# Notes written but not saved\n' });
    expect(await readFile(join(workspace, 'notes.md'), 'utf8')).toBe('# Notes\n');
  });
});

test('claude may use exactly the tools the call offers, through the 3pitor MCP server, and its web tools', async () => {
  await withWorkspace(async (workspace, turn) => {
    const { Read, Glob } = fileTools(workspace, turn);
    const result = await generateText({ model: claudeCliModel('claude-sonnet-5', { Read, Glob }, { webTools: true }), tools: { Read, Glob }, prompt: 'echo args' });
    const { args } = JSON.parse(result.text) as { args: string[] };
    expect(after(args, '--allowedTools')).toBe('mcp__3pitor__Read,mcp__3pitor__Glob,WebSearch,WebFetch');
    expect(JSON.parse(after(args, '--mcp-config')!)).toEqual({
      mcpServers: { '3pitor': { type: 'http', url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f-]{36}$/) } },
    });
  });
});

test('a missing claude fails the call with how to install it or use an API key instead', async () => {
  const empty = await mkdtemp(join(tmpdir(), '3pitor-no-claude-'));
  process.env.PATH = empty;
  try {
    await expect(generateText({ model: model(), prompt: 'Hi' })).rejects.toThrow(CLAUDE_NOT_FOUND_HELP);
    expect(CLAUDE_NOT_FOUND_HELP).toStartWith('The claude program is not on your PATH');
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test('claude exiting with an error and no result reports the exit code and the last thing it printed', async () => {
  await expect(generateText({ model: model(), prompt: 'crash' })).rejects.toThrow('claude exited with code 3: something broke');
});

// A call the way the AI SDK makes one, with a single user message.
const userCall = (text: string, abortSignal?: AbortSignal) => ({
  prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }],
  abortSignal,
});

test('a claude failure before any text fails the call before its stream starts, as an API error does', async () => {
  await expect(model().doStream(userCall('fail'))).rejects.toThrow('claude failed: The model is not available.');
});

test('claude failing to reach 3pitor’s tools fails the call before its stream starts', async () => {
  await withWorkspace(async (workspace, turn) => {
    const { Read } = fileTools(workspace, turn);
    const call = { ...userCall('mcp down'), tools: [{ type: 'function' as const, name: 'Read', inputSchema: { type: 'object' as const } }] };
    await expect(claudeCliModel('claude-sonnet-5', { Read }, { webTools: true }).doStream(call)).rejects.toThrow(
      'claude could not reach 3pitor\'s tools (MCP server "3pitor" status: failed)',
    );
  });
});

test('a claude failure after its text has started arrives as an error in the stream', async () => {
  const { stream } = await model().doStream(userCall('fail after text'));
  const parts = await Array.fromAsync(stream as unknown as AsyncIterable<{ type: string; error?: Error }>);
  expect(parts.map((p) => p.type)).toEqual(['stream-start', 'text-start', 'text-delta', 'text-end', 'error', 'finish']);
  expect(parts[4]!.error!.message).toBe('claude failed: The model is not available.');
});

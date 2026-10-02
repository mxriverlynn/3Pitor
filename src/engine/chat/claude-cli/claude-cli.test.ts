import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText, streamText } from 'ai';
import { fileTools } from '../tools/tools';
import { CLAUDE_NOT_FOUND_HELP, claudeCliModel } from './claude-cli';
import { fakeClaudeOnPath } from '../components/fake-claude-on-path';
import { STUB_MCP_SERVER, stubToolServer } from '../components/stub-tool-server';
import { alive, eventually, untilPid, userCall, withWorkspace } from '../components/chat-test-helpers';

const fakeBin = fakeClaudeOnPath();
const { serveTools } = stubToolServer();

const model = () => claudeCliModel('claude-sonnet-5', {}, { webTools: true, serveTools });

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
  const result = await generateText({ model: claudeCliModel('claude-sonnet-5', {}, { webTools, serveTools }), ...options } as Parameters<typeof generateText>[0]);
  return JSON.parse(result.text) as { args: string[]; cwd: string; mcpToolTimeout?: string };
};
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test('the system messages become claude’s system prompt, and a lone user message goes to stdin as it is', async () => {
  const { args } = await invocation({ system: 'Be brief.', prompt: 'echo args' });
  expect(after(args, '--system-prompt')).toBe('Be brief.');
  expect((await generateText({ model: model(), system: 'Be brief.', prompt: 'echo stdin' })).text).toBe('echo stdin');
});

// A system message marked for caching, as agent.ts marks the fixed prompt.
const marked = (content: string) =>
  ({ role: 'system', content, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }) as const;

test('claude’s system prompt marks where the cacheable part ends: after the first marked message, and only there', async () => {
  const instructions = [{ role: 'system', content: 'Pre' } as const, marked('Marked'), { role: 'system', content: 'Post1' } as const, marked('Post2')];
  const { args } = await invocation({ instructions, prompt: 'echo args' });
  expect(after(args, '--system-prompt')).toBe('Pre\n\nMarked\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\nPost1\n\nPost2');
});

test('a marked message with nothing after it gets no boundary line', async () => {
  const { args } = await invocation({ instructions: [marked('Only')], prompt: 'echo args' });
  expect(after(args, '--system-prompt')).toBe('Only');
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

test('claude may use exactly the tools the call offers, through the 3pitor MCP server, and its web tools', async () => {
  await withWorkspace(async (workspace, turn) => {
    const { Read, Glob } = fileTools(workspace, turn);
    const server = stubToolServer();
    const result = await generateText({
      model: claudeCliModel('claude-sonnet-5', { Read, Glob }, { webTools: true, serveTools: server.serveTools }),
      tools: { Read, Glob },
      prompt: 'echo args',
    });
    const { args } = JSON.parse(result.text) as { args: string[] };
    expect(after(args, '--allowedTools')).toBe('mcp__3pitor__Read,mcp__3pitor__Glob,WebSearch,WebFetch');
    // The entry is whatever the tool server built; claude-cli passes it through unexamined.
    expect(JSON.parse(after(args, '--mcp-config')!)).toEqual({ mcpServers: { '3pitor': STUB_MCP_SERVER } });
    expect(server.served.map((s) => s.defs.map((d) => d.name))).toEqual([['Read', 'Glob']]);
    expect(server.stops).toBe(1);
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

test('a claude failure before any text fails the call before its stream starts, as an API error does', async () => {
  await expect(model().doStream(userCall('fail'))).rejects.toThrow('claude failed: The model is not available.');
});

test('claude failing to reach 3pitor’s tools fails the call before its stream starts', async () => {
  await withWorkspace(async (workspace, turn) => {
    const { Read } = fileTools(workspace, turn);
    const call = { ...userCall('mcp down'), tools: [{ type: 'function' as const, name: 'Read', inputSchema: { type: 'object' as const } }] };
    await expect(claudeCliModel('claude-sonnet-5', { Read }, { webTools: true, serveTools }).doStream(call)).rejects.toThrow(
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

test('a call whose signal is already aborted never starts claude', async () => {
  const log = join(fakeBin(), 'runs.log');
  process.env.FAKE_CLAUDE_LOG = log;
  const controller = new AbortController();
  controller.abort(new Error('stopped by the writer'));
  await expect(model().doStream(userCall('Hi', controller.signal))).rejects.toThrow('stopped by the writer');
  expect(await Bun.file(log).exists()).toBe(false);
});

test('stopping the call kills claude and ends the stream', async () => {
  const controller = new AbortController();
  const { stream } = await model().doStream(userCall('hang', controller.signal));
  const { pid, reader } = await untilPid(stream);

  controller.abort();

  expect(await eventually(() => !alive(pid))).toBe(true);
  const rest = [];
  for (let r = await reader.read(); !r.done; r = await reader.read()) rest.push(r.value.type);
  expect(rest).not.toContain('finish');
});

test('a tool that finishes after the call stopped writes nothing, prints no error, and the endpoint stops once', async () => {
  const errors = spyOn(console, 'error');
  const server = stubToolServer();
  try {
    const controller = new AbortController();
    const call = { ...userCall('hang', controller.signal), tools: [{ type: 'function' as const, name: 'Slow', inputSchema: { type: 'object' as const } }] };
    const { stream } = await claudeCliModel('claude-sonnet-5', {}, { webTools: false, serveTools: server.serveTools }).doStream(call);
    const { reader } = await untilPid(stream);

    controller.abort();
    const rest: string[] = [];
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest.push(r.value.type);
    // The tool finishing now, after the call ended.
    const [{ emit }] = server.served;
    expect(() => emit({ type: 'tool-result', toolCallId: 'mcp-1', toolName: 'Slow', result: 'too late' })).not.toThrow();

    expect(rest).not.toContain('tool-result');
    expect(errors).not.toHaveBeenCalled();
    expect(server.stops).toBe(1);
  } finally {
    errors.mockRestore();
  }
});

test('cancelling the stream kills claude', async () => {
  const { stream } = await model().doStream(userCall('hang'));
  const { pid, reader } = await untilPid(stream);
  await reader.cancel();
  expect(await eventually(() => !alive(pid))).toBe(true);
});

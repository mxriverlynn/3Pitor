import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { LanguageModelV4FunctionTool, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { asSchema, streamText, tool, type ToolSet } from 'ai';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { claudeCliModel } from '../../../engine/chat/claude-cli/claude-cli';
import { editHeading, eventually, replyText, turn, untilPid, userCall, withWorkspace } from '../../../engine/chat/components/chat-test-helpers';
import { fakeClaudeOnPath } from '../../../engine/chat/components/fake-claude-on-path';
import { stateKey } from '../../../engine/components/json-file';
import { createEngine, type ToolEndpoint } from '../../../engine/engine';
import { editedTexts, fileTools, turnTexts } from '../../../engine/chat/tools/tools';
import { serveTools } from './mcp-endpoint';
import { createLocalFileSystem } from '../../../file-system/file-system';

const echo = tool({
  description: 'Say the text back',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => `echo: ${text}`,
});

// The call's tool list, as the AI SDK hands it to a model.
async function defsFor(tools: ToolSet): Promise<LanguageModelV4FunctionTool[]> {
  return Promise.all(
    Object.entries(tools).map(async ([name, t]) => ({
      type: 'function' as const,
      name,
      description: t.description as string,
      inputSchema: await asSchema(t.inputSchema).jsonSchema,
    })),
  );
}

let endpoint: ToolEndpoint | undefined;
let emitted: LanguageModelV4StreamPart[];

afterEach(() => endpoint?.stop());

async function serve(tools: ToolSet, abortSignal?: AbortSignal) {
  emitted = [];
  const served = serveTools(await defsFor(tools), tools, (part) => emitted.push(part), abortSignal);
  endpoint = served;
  // claude reaches the tools over MCP's HTTP transport, on a loopback port, at an unguessable path.
  expect(served.mcpServer).toEqual({ type: 'http', url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f-]{36}$/) });
  return served.mcpServer.url as string;
}

// One JSON-RPC message, the way claude sends it.
const post = (url: string, message: object) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', ...message }),
  });
const rpc = (url: string, method: string, params?: unknown) => post(url, { id: 1, method, params });
const notify = (url: string, method: string) => post(url, { method });

test('initialize answers with the client’s protocol version and offers tools', async () => {
  const url = await serve({ echo });
  const response = await rpc(url, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code' } });
  expect(await response.json()).toEqual({
    jsonrpc: '2.0',
    id: 1,
    result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: '3pitor', version: '1' } },
  });
});

test('a notification gets 202 and no body', async () => {
  const response = await notify(await serve({ echo }), 'notifications/initialized');
  expect(response.status).toBe(202);
  expect(await response.text()).toBe('');
});

test('ping answers with an empty result', async () => {
  const response = await rpc(await serve({ echo }), 'ping');
  expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
});

test('a method 3pitor does not serve, such as claude’s server/discover probe, gets method-not-found', async () => {
  const response = await rpc(await serve({ echo }), 'server/discover', {});
  expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: -32601 } });
});

test('tools/list lists the call’s tools with their descriptions and input schemas', async () => {
  const response = await rpc(await serve({ echo }), 'tools/list', {});
  const [def] = await defsFor({ echo });
  expect(await response.json()).toEqual({
    jsonrpc: '2.0',
    id: 1,
    result: { tools: [{ name: 'echo', description: 'Say the text back', inputSchema: def!.inputSchema }] },
  });
});

test('tools/call runs the tool against the turn’s copy of the posts and reports it as a tool row', async () => {
  const workspace = await mkdtemp(join(tmpdir(), '3pitor-mcp-'));
  try {
    await writeFile(join(workspace, 'notes.md'), '# Notes\n');
    const turn = turnTexts({ 'notes.md': '# Notes typed but not saved\n' });
    const { Edit } = fileTools(createLocalFileSystem(workspace), turn);
    const url = await serve({ Edit });
    const input = { file_path: 'notes.md', old_string: 'typed', new_string: 'written' };

    const response = await rpc(url, 'tools/call', { name: 'Edit', arguments: input, _meta: { progressToken: 2 } });

    const { result } = await response.json();
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
    expect(editedTexts(turn)).toEqual({ 'notes.md': '# Notes written but not saved\n' });
    expect(await readFile(join(workspace, 'notes.md'), 'utf8')).toBe('# Notes\n');
    expect(emitted).toEqual([
      { type: 'tool-call', toolCallId: 'mcp-1', toolName: 'Edit', input: JSON.stringify(input), providerExecuted: true },
      { type: 'tool-result', toolCallId: 'mcp-1', toolName: 'Edit', result: result.content[0].text },
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a tool that throws answers with its message as an error, and its tool row says so', async () => {
  const Read = tool({
    inputSchema: z.object({ file_path: z.string() }),
    execute: async ({ file_path }): Promise<string> => {
      throw new Error(`${file_path} does not exist`);
    },
  });
  const response = await rpc(await serve({ Read }), 'tools/call', { name: 'Read', arguments: { file_path: 'nope.md' } });
  expect((await response.json()).result).toEqual({ content: [{ type: 'text', text: 'nope.md does not exist' }], isError: true });
  expect(emitted[1]).toEqual({ type: 'tool-result', toolCallId: 'mcp-1', toolName: 'Read', result: 'nope.md does not exist', isError: true });
});

test('a call to a tool this call does not offer gets invalid-params and no tool row', async () => {
  const response = await rpc(await serve({ echo }), 'tools/call', { name: 'Write', arguments: {} });
  expect(await response.json()).toMatchObject({ id: 1, error: { code: -32602 } });
  expect(emitted).toEqual([]);
});

test('a call whose arguments do not fit the tool’s schema gets invalid-params and no tool row', async () => {
  const response = await rpc(await serve({ echo }), 'tools/call', { name: 'echo', arguments: { text: 42 } });
  expect(await response.json()).toMatchObject({ id: 1, error: { code: -32602 } });
  expect(emitted).toEqual([]);
});

test('only POST is served on the endpoint’s path, and nothing on any other path', async () => {
  const url = await serve({ echo });
  expect((await fetch(url)).status).toBe(405);
  expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
  expect((await post(`${new URL(url).origin}/mcp/guess`, { id: 1, method: 'tools/list' })).status).toBe(404);
});

test('once stopped, the endpoint accepts no more connections', async () => {
  const url = await serve({ echo });
  endpoint!.stop();
  await expect(rpc(url, 'ping')).rejects.toThrow();
});

test('a running tool sees the call’s abort signal', async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const Wait = tool({
    inputSchema: z.object({}),
    execute: async (_input, { abortSignal }) => {
      seen = abortSignal;
      return 'done';
    },
  });
  await rpc(await serve({ Wait }, controller.signal), 'tools/call', { name: 'Wait', arguments: {} });
  controller.abort();
  expect(seen?.aborted).toBe(true);
});

// A Task call holds its request open for a whole subagent run, well past Bun's 10-second idle limit.
test('a tool call that takes longer than Bun’s idle limit still gets its answer', async () => {
  const Slow = tool({
    inputSchema: z.object({}),
    execute: async () => {
      await Bun.sleep(12_000);
      return 'finally';
    },
  });
  const response = await rpc(await serve({ Slow }), 'tools/call', { name: 'Slow', arguments: {} });
  expect((await response.json()).result.content).toEqual([{ type: 'text', text: 'finally' }]);
}, 20_000);

// Real round trips: the fake claude program calls 3pitor's tools over this endpoint.
fakeClaudeOnPath();

test('claude’s tool calls run in 3pitor against the turn’s copy, and show as tool rows the AI SDK does not run again', async () => {
  await withWorkspace(async (workspace, turn, fileSystem) => {
    const tools = fileTools(fileSystem, turn);
    const result = streamText({
      model: claudeCliModel('claude-sonnet-5', tools, { webTools: true, serveTools }),
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

test('stopping the call during a slow tool call writes nothing once the tool finishes, and prints no error', async () => {
  const errors = spyOn(console, 'error');
  let finished = false;
  const Slow = tool({
    inputSchema: z.object({}),
    execute: async () => {
      await Bun.sleep(300);
      finished = true;
      return 'too late';
    },
  });
  try {
    const controller = new AbortController();
    const call = { ...userCall('slow call Slow {}', controller.signal), tools: [{ type: 'function' as const, name: 'Slow', inputSchema: { type: 'object' as const } }] };
    const { stream } = await claudeCliModel('claude-sonnet-5', { Slow }, { webTools: false, serveTools }).doStream(call);
    const { reader } = await untilPid(stream);

    controller.abort();
    const rest: string[] = [];
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest.push(r.value.type);
    expect(await eventually(() => finished)).toBe(true);
    await Bun.sleep(50);

    expect(rest).not.toContain('tool-result');
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});

describe('a chat turn through the claude program', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), '3pitor-sessions-'));
    await writeFile(join(workspace, 'notes.md'), '# Garden Plan\n');
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  test('edits the post for the editor, shows the edit as a tool row, and saves nothing', async () => {
    const engine = createEngine({ fileSystem: createLocalFileSystem(workspace), claude: 'cli', serveTools });
    const id = await engine.sessions.create();

    const chunks = await turn(engine.sessions, id, `call Edit ${JSON.stringify(editHeading.input)}`);

    expect(chunks.filter((c) => c.type === 'tool-input-available').map((c) => c.toolName)).toEqual(['Edit']);
    expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({
      aborted: false,
      edited: { 'notes.md': '# Vegetable Plan\n' },
      highlights: { file: 'notes.md', passages: [{ quote: 'Vegetable' }] },
    });
    expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Garden Plan\n');
    // The model's history, as stored: the turn completed.
    const stored = JSON.parse(await Bun.file(join(workspace, stateKey('session.json'))).text());
    expect(stored.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
  });

  test('lets claude Read an app skill through 3pitor’s tools', async () => {
    const engine = createEngine({ fileSystem: createLocalFileSystem(workspace), claude: 'cli', serveTools });
    const id = await engine.sessions.create();

    const chunks = await turn(engine.sessions, id, 'call Read {"file_path":"3pitor://skills/proofread/SKILL.md"}');

    expect(replyText(chunks)).toContain('name: proofread');
  });
});

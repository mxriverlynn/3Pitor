import { afterEach, expect, test } from 'bun:test';
import type { LanguageModelV4FunctionTool, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { asSchema, tool, type ToolSet } from 'ai';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { editedTexts, fileTools, turnTexts } from '../tools/tools';
import { serveTools } from './mcp-endpoint';

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

let endpoint: { url: string; stop(): void } | undefined;
let emitted: LanguageModelV4StreamPart[];

afterEach(() => endpoint?.stop());

async function serve(tools: ToolSet, abortSignal?: AbortSignal) {
  emitted = [];
  const served = serveTools(await defsFor(tools), tools, (part) => emitted.push(part), abortSignal);
  endpoint = served;
  return served.url;
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
    const turn = turnTexts(workspace, { 'notes.md': '# Notes typed but not saved\n' });
    const { Edit } = fileTools(workspace, turn);
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

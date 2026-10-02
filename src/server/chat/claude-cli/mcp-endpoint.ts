// Lends 3pitor's tools to the claude program for one model call, over MCP (the protocol claude uses to call tools
// another program hosts). Each tool runs here, in-process, against the turn's copy of the posts.
import { asSchema, type Tool } from 'ai';
import type { ServeTools } from './claude-cli';

export const serveTools: ServeTools = (defs, tools, emit, abortSignal) => {
  const path = `/mcp/${crypto.randomUUID()}`;
  let calls = 0;

  // Runs one tool call and reports it as a tool row. The parts say claude already ran it, so the AI SDK records the
  // call and does not run the tool a second time.
  async function call(tool: Tool, toolName: string, input: unknown) {
    const toolCallId = `mcp-${++calls}`;
    emit({ type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input), providerExecuted: true });
    try {
      const output = await tool.execute!(input, { toolCallId, messages: [], abortSignal, context: undefined });
      emit({ type: 'tool-result', toolCallId, toolName, result: output ?? '' });
      return { content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }], isError: false };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      emit({ type: 'tool-result', toolCallId, toolName, result: text, isError: true });
      return { content: [{ type: 'text', text }], isError: true };
    }
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      // The path is unguessable, so only the claude this call started can reach the tools.
      if (new URL(request.url).pathname !== path) return new Response(null, { status: 404 });
      // No server-sent events and no sessions: claude falls back to plain POSTs.
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const message = await request.json();
      // A notification has no id and wants no answer.
      if (message.id === undefined) return new Response(null, { status: 202 });
      const answer = (result: unknown) => Response.json({ jsonrpc: '2.0', id: message.id, result });
      const fail = (code: number, text: string) => Response.json({ jsonrpc: '2.0', id: message.id, error: { code, message: text } });
      switch (message.method) {
        case 'initialize':
          return answer({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: '3pitor', version: '1' } });
        case 'tools/list':
          return answer({ tools: defs.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        case 'tools/call': {
          const { name, arguments: input } = message.params;
          const tool = defs.some((d) => d.name === name) ? tools[name] : undefined;
          if (!tool) return fail(-32602, `3pitor has no tool named ${name} for this call`);
          const checked = await asSchema(tool.inputSchema).validate?.(input);
          if (checked && !checked.success) return fail(-32602, `Invalid arguments for ${name}: ${checked.error.message}`);
          return answer(await call(tool, name, checked ? checked.value : input));
        }
        case 'ping':
          return answer({});
        default:
          return fail(-32601, `3pitor does not serve ${message.method}`);
      }
    },
  });
  return { mcpServer: { type: 'http', url: `${server.url.origin}${path}` }, stop: () => server.stop(true) };
};

// An AI SDK model that runs the installed claude program once per model call, so chat can use the operator's Claude
// subscription. It owns starting and stopping the child process, its arguments and environment, what goes to stdin,
// abort, and error messages. It does not decide which tools exist, the step limits, or anything the UI shows.
import { tmpdir } from 'node:os';
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FunctionTool,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4ToolResultOutput,
} from '@ai-sdk/provider';
import type { ToolSet } from 'ai';
import { lines, streamJsonParts } from './stream-json';

// What to tell someone whose chat runs through the claude program when it is not installed.
export const CLAUDE_NOT_FOUND_HELP = `The claude program is not on your PATH, so chat won't work in CLI mode.

Install Claude Code and sign in (https://code.claude.com/docs/en/setup), or start 3pitor with an API key:

  ANTHROPIC_API_KEY=sk-ant-... 3pitor`;

// One entry of the claude program's --mcp-config "mcpServers" map: how claude reaches the server that hosts this
// call's tools. Built by whoever serves the tools; must be JSON-serializable. It is passed through to claude
// unexamined, so this code never names a transport, a host, or a URL.
export type McpServerEntry = Readonly<Record<string, unknown>>;

// The tools of one model call, being served to claude until stop().
export interface ToolEndpoint {
  readonly mcpServer: McpServerEntry;
  stop(): void;
}

// Starts serving one call's tools. Each tool runs in-process against the turn's copy; every call and result is
// reported through emit as a provider-executed tool-call / tool-result part.
export type ServeTools = (
  defs: LanguageModelV4FunctionTool[],
  tools: ToolSet,
  emit: (part: LanguageModelV4StreamPart) => void,
  abortSignal?: AbortSignal,
) => ToolEndpoint;

type CliOptions = { webTools: boolean; serveTools: ServeTools };

export function claudeCliModel(modelId: string, tools: ToolSet, options: CliOptions): LanguageModelV4 {
  const doStream = async (call: LanguageModelV4CallOptions) => ({ stream: await runClaude(modelId, tools, options, call) });
  return {
    specificationVersion: 'v4',
    provider: 'claude-cli',
    modelId,
    supportedUrls: {},
    doStream,
    doGenerate: async (call) => collect((await doStream(call)).stream),
  };
}

// Folds a streamed run into one result, for generateText.
async function collect(stream: ReadableStream<LanguageModelV4StreamPart>): Promise<LanguageModelV4GenerateResult> {
  const content: LanguageModelV4Content[] = [];
  const texts = new Map<string, { type: 'text'; text: string }>();
  let finish: Extract<LanguageModelV4StreamPart, { type: 'finish' }> | undefined;
  for await (const part of stream as unknown as AsyncIterable<LanguageModelV4StreamPart>) {
    if (part.type === 'text-start') {
      const text = { type: 'text' as const, text: '' };
      texts.set(part.id, text);
      content.push(text);
    } else if (part.type === 'text-delta') texts.get(part.id)!.text += part.delta;
    else if (part.type === 'tool-call' || part.type === 'tool-result') content.push(part);
    else if (part.type === 'error') throw part.error;
    else if (part.type === 'finish') finish = part;
  }
  if (!finish) throw new Error('claude stopped without finishing its reply');
  return { content, finishReason: finish.finishReason, usage: finish.usage, warnings: [] };
}

async function runClaude(
  modelId: string,
  tools: ToolSet,
  options: CliOptions,
  call: LanguageModelV4CallOptions,
): Promise<ReadableStream<LanguageModelV4StreamPart>> {
  call.abortSignal?.throwIfAborted();
  let output!: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
  let cancelled = false;
  const stream = new ReadableStream<LanguageModelV4StreamPart>({
    start: (controller) => void (output = controller),
    cancel: () => {
      cancelled = true;
      cleanup();
    },
  });
  // The stream is held back until claude's first text or tool call. A failure that arrives first rejects `ready`, so
  // the call fails before its stream starts, as an API error does, and never reaches the chat's history.
  const ready = Promise.withResolvers<void>();
  let started = false;
  let closed = false;
  let proc: Bun.Subprocess<Blob, 'pipe', 'pipe'> | undefined;

  // Ends the call however it ends. Once closed, nothing more is written, so a tool that finishes late writes nothing.
  const cleanup = () => {
    if (closed) return;
    closed = true;
    call.abortSignal?.removeEventListener('abort', cleanup);
    proc?.kill();
    endpoint?.stop();
    // A stream its reader cancelled is already closed.
    if (!cancelled) output.close();
  };

  const emit = (part: LanguageModelV4StreamPart) => {
    if (closed) return;
    if (!started && part.type === 'error') {
      ready.reject(part.error);
      cleanup();
      return;
    }
    if (part.type === 'text-start' || part.type === 'tool-call') {
      started = true;
      ready.resolve();
    }
    output.enqueue(part);
  };

  // The call's own tool list picks which of 3pitor's tools claude may use.
  const defs = (call.tools ?? []).filter((t) => t.type === 'function');
  const endpoint = defs.length ? options.serveTools(defs, tools, emit, call.abortSignal) : undefined;
  try {
    proc = Bun.spawn(['claude', ...claudeArgs(modelId, call.prompt, defs, options.webTools, endpoint?.mcpServer)], {
      // A neutral folder, so a workspace's CLAUDE.md and .mcp.json never load.
      cwd: tmpdir(),
      env: childEnv(),
      stdin: new Blob([stdinFor(call.prompt)]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (error) {
    cleanup();
    throw (error as { code?: string }).code === 'ENOENT' ? new Error(CLAUDE_NOT_FOUND_HELP) : error;
  }
  const child = proc;
  call.abortSignal?.addEventListener('abort', cleanup);

  (async () => {
    // Drained alongside stdout, so a chatty claude never blocks on a full pipe.
    const stderr = tail(child.stderr);
    let finished = false;
    const parts = child.stdout.pipeThrough(new TextDecoderStream()).pipeThrough(lines()).pipeThrough(streamJsonParts());
    for await (const part of parts as unknown as AsyncIterable<LanguageModelV4StreamPart>) {
      if (part.type === 'finish') finished = true;
      emit(part);
    }
    const [lastLines, code] = await Promise.all([stderr, child.exited]);
    if (code !== 0 && !finished) {
      const lastLine = lastLines.split('\n').filter((line) => line.trim()).at(-1) ?? 'no output';
      emit({ type: 'error', error: new Error(`claude exited with code ${code}: ${lastLine}`) });
    }
    // A run that ends with no text, such as a bare finish, starts its stream here.
    ready.resolve();
    cleanup();
  })();
  await ready.promise;
  return stream;
}

// claude can't read provider options, so a system message marked for caching becomes the line claude caches its
// system prompt up to. Only the first marked message gets one, and only when more system text follows it.
const BOUNDARY = '\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\n';

function systemPrompt(prompt: LanguageModelV4Prompt): string {
  const system = prompt.filter((m) => m.role === 'system');
  const cut = system.findIndex((m) => m.providerOptions?.anthropic?.cacheControl) + 1;
  const join = (messages: typeof system) => messages.map((m) => m.content).join('\n\n');
  return 0 < cut && cut < system.length ? join(system.slice(0, cut)) + BOUNDARY + join(system.slice(cut)) : join(system);
}

function claudeArgs(
  modelId: string,
  prompt: LanguageModelV4Prompt,
  defs: LanguageModelV4FunctionTool[],
  webTools: boolean,
  mcpServer: McpServerEntry | undefined,
): string[] {
  const system = systemPrompt(prompt);
  const allowed = [...defs.map((d) => `mcp__3pitor__${d.name}`), ...(webTools ? ['WebSearch', 'WebFetch'] : [])];
  return [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--input-format', 'text',
    '--model', modelId, '--system-prompt', system, '--no-session-persistence',
    // Leave out the operator's own settings, skills, and MCP servers, which would otherwise load.
    '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config',
    // claude's own file tools stay off: edits must land on the turn's copy, through 3pitor's tools.
    '--tools', webTools ? 'WebSearch,WebFetch' : '',
    ...(mcpServer ? ['--mcp-config', JSON.stringify({ mcpServers: { '3pitor': mcpServer } })] : []),
    // Pre-approves the tools, since nobody is there to answer a permission prompt.
    ...(allowed.length ? ['--allowedTools', allowed.join(',')] : []),
  ];
}

// The last 4 KB or so of a stream, read to its end.
async function tail(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    text = (text + decoder.decode(chunk, { stream: true })).slice(-4096);
  }
  return text + decoder.decode();
}

// Without API credentials, so claude uses the subscription even when a key is set. MCP_TOOL_TIMEOUT is raised because
// claude gives up on an MCP tool call after about a minute by default, and a Task call can run far longer; only the
// writer's stop should end it. An explicit env also makes Bun look claude up on the current PATH, not the one it
// started with.
function childEnv(): Record<string, string | undefined> {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...env } = process.env;
  return { ...env, MCP_TOOL_TIMEOUT: String(24 * 60 * 60 * 1000) };
}

// claude cannot take another program's history, so every call replays it as text: the new message alone, or a
// transcript of the earlier messages followed by the new one.
function stdinFor(prompt: LanguageModelV4Prompt): string {
  const messages = prompt.filter((m) => m.role !== 'system');
  const last = messages.at(-1);
  if (!last) return '';
  if (messages.length === 1) return partTexts(last).join('\n');
  const history = messages.slice(0, -1).map(render).join('\n');
  return `<history>\n${history}\n</history>\n\n${render(last)}`;
}

function render(message: LanguageModelV4Message): string {
  return `<message role="${message.role}">\n${partTexts(message).join('\n')}\n</message>`;
}

// Reasoning and file parts are left out.
function partTexts(message: LanguageModelV4Message): string[] {
  if (message.role === 'system') return [message.content];
  return message.content.flatMap((part) => {
    if (part.type === 'text') return [part.text];
    if (part.type === 'tool-call') return [`[tool call ${part.toolName} ${JSON.stringify(part.input)}]`];
    if (part.type === 'tool-result') return [`[tool result ${part.toolName}] ${outputText(part.output)}`];
    return [];
  });
}

function outputText(output: LanguageModelV4ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value);
    case 'content':
      return output.value.flatMap((item) => (item.type === 'text' ? [item.text] : [])).join('');
    default:
      return '[unsupported]';
  }
}

// An AI SDK model that runs the installed claude program once per model call, so chat can use the operator's Claude
// subscription. It owns starting and stopping the child process, its arguments and environment, what goes to stdin,
// abort, and error messages. It does not decide which tools exist, the step limits, or anything the UI shows.
import { tmpdir } from 'node:os';
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4ToolResultOutput,
} from '@ai-sdk/provider';
import type { ToolSet } from 'ai';
import { lines, streamJsonParts } from './stream-json';

export function claudeCliModel(modelId: string, tools: ToolSet, options: { webTools: boolean }): LanguageModelV4 {
  const doStream = async (call: LanguageModelV4CallOptions) => ({ stream: runClaude(modelId, options, call) });
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

function runClaude(modelId: string, options: { webTools: boolean }, call: LanguageModelV4CallOptions): ReadableStream<LanguageModelV4StreamPart> {
  const system = call.prompt
    .flatMap((m) => (m.role === 'system' ? [m.content] : []))
    .join('\n\n');
  const webTools = options.webTools ? ['WebSearch', 'WebFetch'] : [];
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--input-format', 'text',
    '--model', modelId, '--system-prompt', system, '--no-session-persistence',
    // Leave out the operator's own settings, skills, and MCP servers, which would otherwise load.
    '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config',
    // claude's own file tools stay off: edits must land on the turn's copy, through 3pitor's tools.
    '--tools', webTools.join(','),
    ...(webTools.length ? ['--allowedTools', webTools.join(',')] : []),
  ];
  const proc = Bun.spawn(['claude', ...args], {
    // A neutral folder, so a workspace's CLAUDE.md and .mcp.json never load.
    cwd: tmpdir(),
    env: childEnv(),
    stdin: new Blob([stdinFor(call.prompt)]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return proc.stdout.pipeThrough(new TextDecoderStream()).pipeThrough(lines()).pipeThrough(streamJsonParts());
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

// An AI SDK model that runs the installed claude program once per model call, so chat can use the operator's Claude
// subscription. It owns starting and stopping the child process, its arguments and environment, what goes to stdin,
// abort, and error messages. It does not decide which tools exist, the step limits, or anything the UI shows.
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import type { ToolSet } from 'ai';
import { lines, streamJsonParts } from './stream-json';

export function claudeCliModel(modelId: string, tools: ToolSet, options: { webTools: boolean }): LanguageModelV4 {
  const doStream = async (call: LanguageModelV4CallOptions) => ({ stream: runClaude(modelId, call) });
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

function runClaude(modelId: string, call: LanguageModelV4CallOptions): ReadableStream<LanguageModelV4StreamPart> {
  const text = call.prompt
    .flatMap((m): { type: string; text?: string }[] => (m.role === 'system' ? [] : m.content))
    .map((part) => part.text ?? '')
    .join('');
  const proc = Bun.spawn(['claude', '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', modelId], {
    env: childEnv(),
    stdin: new Blob([text]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return proc.stdout.pipeThrough(new TextDecoderStream()).pipeThrough(lines()).pipeThrough(streamJsonParts());
}

// Without API credentials, so claude uses the subscription even when a key is set. An explicit env also makes Bun look
// claude up on the current PATH, not the one it started with.
function childEnv(): Record<string, string | undefined> {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...env } = process.env;
  return env;
}

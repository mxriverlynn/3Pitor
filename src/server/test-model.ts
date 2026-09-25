// A scripted stand-in for the Anthropic model, for tests that need no API key. Each model call takes
// the next reply from the script: a string is a text reply, and an array is a set of tool calls.
import { mock } from 'bun:test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';

type Reply = string | { tool: string; input: unknown }[];

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

export function scriptedModel(...script: Reply[]) {
  let call = 0;
  const next = () => {
    const reply = script[call++];
    if (reply === undefined) throw new Error(`the script has no reply for model call ${call}`);
    if (typeof reply === 'string') {
      return { content: [{ type: 'text' as const, text: reply }], finishReason: { unified: 'stop' as const, raw: 'end_turn' } };
    }
    const content = reply.map(({ tool, input }, i) => ({
      type: 'tool-call' as const,
      toolCallId: `call-${call}-${i}`,
      toolName: tool,
      input: JSON.stringify(input),
    }));
    return { content, finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' } };
  };
  return new MockLanguageModelV4({
    doGenerate: async () => ({ ...next(), usage, warnings: [] }),
    doStream: async () => {
      const { content, finishReason } = next();
      const parts: LanguageModelV4StreamPart[] = content.flatMap((part): LanguageModelV4StreamPart[] =>
        part.type === 'text'
          ? [
              { type: 'text-start' as const, id: 't' },
              { type: 'text-delta' as const, id: 't', delta: part.text },
              { type: 'text-end' as const, id: 't' },
            ]
          : [part],
      );
      return {
        stream: convertArrayToReadableStream<LanguageModelV4StreamPart>([
          { type: 'stream-start', warnings: [] },
          ...parts,
          { type: 'finish', finishReason, usage },
        ]),
      };
    },
  });
}

// Every model agentSettings builds is `model`, whatever id it asks for, until the next call.
export function useModel(model: MockLanguageModelV4) {
  mock.module('@ai-sdk/anthropic', () => ({ anthropic: () => model }));
}

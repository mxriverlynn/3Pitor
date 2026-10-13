// Prints each call's cache read and write counts, so the operator can see whether caching works. Both Claude backends
// wrap their models in it.
import type { LanguageModelV4, LanguageModelV4StreamPart, LanguageModelV4Usage } from '@ai-sdk/provider';
import type { LanguageModelMiddleware } from 'ai';

// A count the backend did not report prints as -, never 0.
const printCacheUsage = (model: LanguageModelV4, { inputTokens }: LanguageModelV4Usage) =>
  console.log(`3pitor: cache ${model.provider} ${model.modelId}: read ${inputTokens.cacheRead ?? '-'}, write ${inputTokens.cacheWrite ?? '-'}`);

// Passes every result and part through as it is, and prints when the call finishes.
export const logCacheUsage: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate, model }) => {
    const result = await doGenerate();
    printCacheUsage(model, result.usage);
    return result;
  },
  wrapStream: async ({ doStream, model }) => {
    const { stream, ...rest } = await doStream();
    const logged = new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
      transform(part, controller) {
        if (part.type === 'finish') printCacheUsage(model, part.usage);
        controller.enqueue(part);
      },
    });
    return { stream: stream.pipeThrough(logged), ...rest };
  },
};

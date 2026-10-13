// The AI SDK's own thinking setting, for providers that take it: each call is asked to reason at `level`.
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { wrapLanguageModel } from 'ai';
import type { ThinkingLevel } from '../../../shared/wire';

// The model unchanged when there is no level, so the provider's default applies. The AI SDK's setting stops at xhigh,
// so max asks for that; no catalog offers max on these providers.
export function reasoningAt(model: LanguageModelV4, level: ThinkingLevel | undefined): LanguageModelV4 {
  if (!level) return model;
  const reasoning = level === 'max' ? 'xhigh' : level;
  return wrapLanguageModel({ model, middleware: { transformParams: async ({ params }) => ({ ...params, reasoning }) } });
}

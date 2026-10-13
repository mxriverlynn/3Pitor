// Claude through the Anthropic API, with the operator's ANTHROPIC_API_KEY.
import { anthropic } from '@ai-sdk/anthropic';
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai';
import { logCacheUsage } from './cache-usage';
import { CLAUDE_MODELS } from './claude-models';
import type { ThinkingLevel } from '../../../shared/wire';
import type { ProviderBackend } from './providers';

// What to tell someone who started 3pitor without an API key, at startup and when a turn fails.
export const MISSING_API_KEY_HELP = `ANTHROPIC_API_KEY is not set, so chat won't work.

To fix it, create a key at https://console.anthropic.com/settings/keys, then start 3pitor with it:

  ANTHROPIC_API_KEY=sk-ant-... 3pitor`;

// Asks Anthropic to cache each call's prompt up to its last message, for the default five minutes. Also asks for
// 128,000 output tokens, the most every listed model allows: the package caps a model it does not know yet, such as
// claude-haiku-5-5, and warns on every call unless the call names a limit.
const apiDefaults = defaultSettingsMiddleware({
  settings: { maxOutputTokens: 128_000, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
});

// Asks for an effort level; it deep-merges with the cache setting.
const effortOf = (effort: ThinkingLevel) => defaultSettingsMiddleware({ settings: { providerOptions: { anthropic: { effort } } } });

const apiModel = (modelId: string, thinking?: ThinkingLevel) =>
  wrapLanguageModel({
    model: anthropic(modelId),
    middleware: [logCacheUsage, apiDefaults, ...(thinking ? [effortOf(thinking)] : [])],
  });

export const apiBackend: ProviderBackend = {
  id: 'claude-api',
  label: 'the Anthropic API',
  access: 'api',
  catalog: CLAUDE_MODELS,
  models: async () => [...CLAUDE_MODELS],
  problem: (env) => (env.ANTHROPIC_API_KEY ? undefined : MISSING_API_KEY_HELP),
  chatModel: (modelId, _tools, thinking) => apiModel(modelId, thinking),
  subagentModel: (modelId) => apiModel(modelId),
  // Run by Anthropic inside a model call, so they spend none of the turn's steps; each is capped per call instead.
  providerTools: () => ({
    web_search: anthropic.tools.webSearch_20250305({ maxUses: 10 }),
    web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 10 }),
  }),
};

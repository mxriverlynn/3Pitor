// Claude through the Anthropic API, with the operator's ANTHROPIC_API_KEY.
import { anthropic } from '@ai-sdk/anthropic';
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai';
import { logCacheUsage } from './cache-usage';
import { CLAUDE_MODELS } from './claude-models';
import type { ProviderBackend } from './providers';

// What to tell someone who started 3pitor without an API key, at startup and when a turn fails.
export const MISSING_API_KEY_HELP = `ANTHROPIC_API_KEY is not set, so chat won't work.

To fix it, create a key at https://console.anthropic.com/settings/keys, then start 3pitor with it:

  ANTHROPIC_API_KEY=sk-ant-... 3pitor`;

// Asks Anthropic to cache each call's prompt up to its last message, for the default five minutes.
const cacheAutomatically = defaultSettingsMiddleware({
  settings: { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
});

const apiModel = (modelId: string) => wrapLanguageModel({ model: anthropic(modelId), middleware: [logCacheUsage, cacheAutomatically] });

export const apiBackend: ProviderBackend = {
  id: 'claude-api',
  label: 'the Anthropic API',
  access: 'api',
  catalog: CLAUDE_MODELS,
  models: async () => [...CLAUDE_MODELS],
  problem: (env) => (env.ANTHROPIC_API_KEY ? undefined : MISSING_API_KEY_HELP),
  chatModel: (modelId) => apiModel(modelId),
  subagentModel: (modelId) => apiModel(modelId),
  // Run by Anthropic inside a model call, so they spend none of the turn's steps; each is capped per call instead.
  providerTools: () => ({
    web_search: anthropic.tools.webSearch_20250305({ maxUses: 10 }),
    web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 10 }),
  }),
};

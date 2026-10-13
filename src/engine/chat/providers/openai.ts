// OpenAI's models through its API, with the operator's OPENAI_API_KEY.
import { openai } from '@ai-sdk/openai';
import type { ProviderBackend } from './providers';

export const openaiBackend: ProviderBackend = {
  id: 'openai',
  label: 'OpenAI',
  access: 'api',
  catalog: [],
  models: async () => [],
  problem: () => undefined,
  chatModel: (modelId) => openai(modelId),
  subagentModel: (modelId) => openai(modelId),
  providerTools: () => ({}),
};

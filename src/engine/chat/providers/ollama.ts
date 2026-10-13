// Models the operator has pulled into Ollama, running on this computer, through its OpenAI-compatible endpoint.
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ProviderBackend } from './providers';

const host = 'http://localhost:11434';

// Ollama needs a key to be sent, and ignores what it is.
const ollama = () => createOpenAICompatible({ name: 'ollama', baseURL: `${host}/v1`, apiKey: 'ollama' });

export const ollamaBackend: ProviderBackend = {
  id: 'ollama',
  label: 'Ollama',
  access: 'local',
  catalog: [],
  models: async () => [],
  problem: () => undefined,
  chatModel: (modelId) => ollama()(modelId),
  subagentModel: (modelId) => ollama()(modelId),
  providerTools: () => ({}),
};

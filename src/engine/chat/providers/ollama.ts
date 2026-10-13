// Models the operator has pulled into Ollama, running on this computer, through its OpenAI-compatible endpoint.
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ModelInfo } from '../../../shared/wire';
import type { ProviderBackend } from './providers';

type Env = Record<string, string | undefined>;

// OLLAMA_HOST as a full URL, or Ollama's own default.
const hostOf = (env: Env) => env.OLLAMA_HOST || 'http://localhost:11434';

// env gives the host chat models are built against; models() reads the env it is given.
export function ollamaBackend(env: Env): ProviderBackend {
  // Ollama needs a key to be sent, and ignores what it is.
  const model = (modelId: string) => createOpenAICompatible({ name: 'ollama', baseURL: `${hostOf(env)}/v1`, apiKey: 'ollama' })(modelId);
  return {
    id: 'ollama',
    label: 'Ollama',
    access: 'local',
    // Whatever the operator pulled, so nothing is written into the code.
    catalog: [],
    models: (env) => pulledModels(hostOf(env)),
    // A stopped Ollama shows up as models() failing.
    problem: () => undefined,
    chatModel: (modelId) => model(modelId),
    subagentModel: (modelId) => model(modelId),
    providerTools: () => ({}),
  };
}

// The models Ollama at `host` has pulled.
async function pulledModels(host: string): Promise<ModelInfo[]> {
  const { models } = (await (await fetch(`${host}/api/tags`)).json()) as { models: { name: string }[] };
  return models.map(({ name }) => ({ id: name, label: name, thinking: [] }));
}

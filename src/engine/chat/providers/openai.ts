// OpenAI's models through its API, with the operator's OPENAI_API_KEY.
import { openai } from '@ai-sdk/openai';
import type { ModelInfo, ThinkingLevel } from '../../../shared/wire';
import type { ProviderBackend } from './providers';
import { reasoningAt } from './reasoning';

// What to tell someone who chose OpenAI without a key, at startup, in the picker, and when a turn fails.
const MISSING_KEY_HELP = `OPENAI_API_KEY is not set, so chat won't work with OpenAI.

To fix it, create a key at https://platform.openai.com/api-keys, then start 3pitor with it:

  OPENAI_API_KEY=sk-... 3pitor`;

// Every listed model takes these three; the higher ones vary by model.
const LEVELS: ThinkingLevel[] = ['low', 'medium', 'high'];

const MODELS: readonly ModelInfo[] = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', thinking: LEVELS },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', thinking: LEVELS },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', thinking: LEVELS },
];

export const openaiBackend: ProviderBackend = {
  id: 'openai',
  label: 'OpenAI',
  access: 'api',
  catalog: MODELS,
  models: async () => [...MODELS],
  problem: (env) => (env.OPENAI_API_KEY ? undefined : MISSING_KEY_HELP),
  chatModel: (modelId, _tools, thinking) => reasoningAt(openai(modelId), thinking),
  subagentModel: (modelId) => openai(modelId),
  providerTools: () => ({}),
};

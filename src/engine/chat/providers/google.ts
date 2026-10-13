// Google's Gemini models through its API, with the operator's GOOGLE_GENERATIVE_AI_API_KEY.
import { google } from '@ai-sdk/google';
import type { ProviderBackend } from './providers';

export const googleBackend: ProviderBackend = {
  id: 'google',
  label: 'Google Gemini',
  access: 'api',
  catalog: [],
  models: async () => [],
  problem: () => undefined,
  chatModel: (modelId) => google(modelId),
  subagentModel: (modelId) => google(modelId),
  providerTools: () => ({}),
};

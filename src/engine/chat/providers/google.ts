// Google's Gemini models through its API, with the operator's GOOGLE_GENERATIVE_AI_API_KEY.
import { google } from '@ai-sdk/google';
import type { ModelInfo, ThinkingLevel } from '../../../shared/wire';
import type { ProviderBackend } from './providers';
import { reasoningAt } from './reasoning';

// What to tell someone who chose Gemini without a key, at startup, in the picker, and when a turn fails.
const MISSING_KEY_HELP = `GOOGLE_GENERATIVE_AI_API_KEY is not set, so chat won't work with Google Gemini.

To fix it, create a key at https://aistudio.google.com/apikey, then start 3pitor with it:

  GOOGLE_GENERATIVE_AI_API_KEY=... 3pitor`;

// Every listed model takes these three; Gemini lowers anything higher to high.
const LEVELS: ThinkingLevel[] = ['low', 'medium', 'high'];

const MODELS: readonly ModelInfo[] = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', thinking: LEVELS },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', thinking: LEVELS },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', thinking: LEVELS },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', thinking: LEVELS },
];

export const googleBackend: ProviderBackend = {
  id: 'google',
  label: 'Google Gemini',
  access: 'api',
  catalog: MODELS,
  models: async () => [...MODELS],
  problem: (env) => (env.GOOGLE_GENERATIVE_AI_API_KEY ? undefined : MISSING_KEY_HELP),
  chatModel: (modelId, _tools, thinking) => reasoningAt(google(modelId), thinking),
  subagentModel: (modelId) => google(modelId),
  providerTools: () => ({}),
};

// The selectedModel section of .3pitor/config.json: which provider, model, and thinking level a new chat uses. It reads,
// checks, and writes that section, and keeps every other key in the file as it is.
import type { ModelSelection, ProviderId, ThinkingLevel } from '../../shared/wire';

type Env = Record<string, string | undefined>;

// Claude Haiku 5.5 on medium thinking: through the API when there is a key, and the claude program when not.
export function defaultSelection(env: Env): ModelSelection {
  return { provider: env.ANTHROPIC_API_KEY ? 'claude-api' : 'claude-cli', model: 'claude-haiku-5-5', thinking: 'medium' };
}

const PROVIDERS: readonly ProviderId[] = ['claude-cli', 'claude-api'];
const LEVELS: readonly ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

// A known provider, a non-empty model, and thinking absent or one of the levels; else undefined. Other fields are
// dropped. It does not check the model against any list.
export function parseSelection(value: unknown): ModelSelection | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { provider, model, thinking } = value as Record<string, unknown>;
  if (!PROVIDERS.includes(provider as ProviderId) || typeof model !== 'string' || model === '') return undefined;
  if (thinking === undefined) return { provider: provider as ProviderId, model };
  if (!LEVELS.includes(thinking as ThinkingLevel)) return undefined;
  return { provider: provider as ProviderId, model, thinking: thinking as ThinkingLevel };
}

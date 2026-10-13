// The selectedModel section of .3pitor/config.json: which provider, model, and thinking level a new chat uses. It reads,
// checks, and writes that section, and keeps every other key in the file as it is.
import type { ModelSelection } from '../../shared/wire';

type Env = Record<string, string | undefined>;

// Claude Haiku 5.5 on medium thinking: through the API when there is a key, and the claude program when not.
export function defaultSelection(env: Env): ModelSelection {
  return { provider: env.ANTHROPIC_API_KEY ? 'claude-api' : 'claude-cli', model: 'claude-haiku-5-5', thinking: 'medium' };
}

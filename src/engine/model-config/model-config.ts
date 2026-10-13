// The selectedModel section of .3pitor/config.json: which provider, model, and thinking level a new chat uses. It reads,
// checks, and writes that section, and keeps every other key in the file as it is.
import type { ModelSelection, ProviderId, ThinkingLevel } from '../../shared/wire';
import type { FileSystem } from '../../file-system/file-system';
import type { ProviderBackend } from '../chat/providers/providers';
import { readJson, stateKey, writeJson } from '../components/json-file';

type Env = Record<string, string | undefined>;
type Backends = Record<ProviderId, ProviderBackend>;

// Claude Haiku 5.5 on medium thinking: through the API when there is a key, and the claude program when not.
export function defaultSelection(env: Env): ModelSelection {
  return { provider: env.ANTHROPIC_API_KEY ? 'claude-api' : 'claude-cli', model: 'claude-haiku-5-5', thinking: 'medium' };
}

const PROVIDERS: readonly ProviderId[] = ['claude-cli', 'claude-api', 'openai', 'google', 'ollama'];
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

// Whether the selection fits its provider's catalog: a listed model takes no level or one it offers, and a model the
// catalog does not list (any Ollama model, or an id the code does not know) takes no level. It never fetches.
export function fitsCatalog({ provider, model, thinking }: ModelSelection, backends: Backends): boolean {
  if (thinking === undefined) return true;
  return backends[provider].catalog.find((m) => m.id === model)?.thinking.includes(thinking) ?? false;
}

// The saved selection, or the default. A selectedModel that is there but cannot be used is warned about on each read,
// naming why and what is used instead.
export async function loadSelection(fileSystem: FileSystem, env: Env, backends: Backends): Promise<ModelSelection> {
  const value = (await readConfig(fileSystem)).selectedModel;
  if (value === undefined) return defaultSelection(env);
  const saved = parseSelection(value);
  const reason =
    !saved ? 'it must name a known provider, a model, and a thinking level'
    : !fitsCatalog(saved, backends) ? `${saved.model} does not offer ${saved.thinking} thinking`
    : undefined;
  if (!reason) return saved!;
  const fallback = defaultSelection(env);
  console.warn(`3pitor: ignoring selectedModel in .3pitor/config.json (${reason}); using ${fallback.provider} ${fallback.model}`);
  return fallback;
}

// Replaces selectedModel and keeps every other key, as one atomic write. A file that is missing or not a JSON object
// starts from {}. Rejects when the write fails.
export async function saveSelection(fileSystem: FileSystem, selection: ModelSelection): Promise<void> {
  const config = await readConfig(fileSystem);
  await writeJson(fileSystem, stateKey('config.json'), { ...config, selectedModel: selection });
}

// The config file's object, or {} when it is missing or is not a JSON object.
async function readConfig(fileSystem: FileSystem): Promise<Record<string, unknown>> {
  const config = await readJson(fileSystem, stateKey('config.json'));
  return typeof config === 'object' && config !== null && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
}

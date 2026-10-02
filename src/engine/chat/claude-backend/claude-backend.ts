// The ways chat can reach Claude, and everything that differs between them. This is the one place that knows which
// modes exist; agent.ts and the engine's startup ask the mode's backend and never check the mode themselves.
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV4, LanguageModelV4StreamPart, LanguageModelV4Usage } from '@ai-sdk/provider';
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModelMiddleware, type ToolSet } from 'ai';
import type { ClaudeMode } from '../../../shared/wire';
import { CLAUDE_NOT_FOUND_HELP, claudeCliModel, type ServeTools } from '../claude-cli/claude-cli';

export interface ClaudeBackend {
  readonly mode: ClaudeMode;
  // Completes "3pitor chat: claude via <label>".
  readonly label: string;
  // What startup prints when this mode cannot work as things stand, or undefined.
  startupWarning(env: Record<string, string | undefined>): string | undefined;
  // The model for the main chat, and for Task subagents; tools are the ones the call may use.
  chatModel(modelId: string, tools: ToolSet): LanguageModelV4;
  subagentModel(modelId: string, tools: ToolSet): LanguageModelV4;
  // Tools the provider runs itself, inside a model call.
  providerTools(): ToolSet;
}

// What to tell someone who started 3pitor without an API key, at startup and when a turn fails.
export const MISSING_API_KEY_HELP = `ANTHROPIC_API_KEY is not set, so chat won't work.

To fix it, create a key at https://console.anthropic.com/settings/keys, then start 3pitor with it:

  ANTHROPIC_API_KEY=sk-ant-... 3pitor`;

// Prints each call's cache read and write counts, so the operator can see whether caching works. A count the
// backend did not report prints as -, never 0.
const printCacheUsage = (model: LanguageModelV4, { inputTokens }: LanguageModelV4Usage) =>
  console.log(`3pitor: cache ${model.provider} ${model.modelId}: read ${inputTokens.cacheRead ?? '-'}, write ${inputTokens.cacheWrite ?? '-'}`);

// Passes every result and part through as it is, and prints when the call finishes.
const logCacheUsage: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate, model }) => {
    const result = await doGenerate();
    printCacheUsage(model, result.usage);
    return result;
  },
  wrapStream: async ({ doStream, model }) => {
    const { stream, ...rest } = await doStream();
    const logged = new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
      transform(part, controller) {
        if (part.type === 'finish') printCacheUsage(model, part.usage);
        controller.enqueue(part);
      },
    });
    return { stream: stream.pipeThrough(logged), ...rest };
  },
};

// Asks Anthropic to cache each call's prompt up to its last message, for the default five minutes.
const cacheAutomatically = defaultSettingsMiddleware({
  settings: { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
});

const apiModel = (modelId: string) => wrapLanguageModel({ model: anthropic(modelId), middleware: [logCacheUsage, cacheAutomatically] });

export const apiBackend: ClaudeBackend = {
  mode: 'api',
  label: 'the Anthropic API',
  startupWarning: (env) => (env.ANTHROPIC_API_KEY ? undefined : MISSING_API_KEY_HELP),
  chatModel: (modelId) => apiModel(modelId),
  subagentModel: (modelId) => apiModel(modelId),
  // Run by Anthropic inside a model call, so they spend none of the turn's steps; each is capped per call instead.
  providerTools: () => ({
    web_search: anthropic.tools.webSearch_20250305({ maxUses: 10 }),
    web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 10 }),
  }),
};

// No cache setting, since claude ignores call-level provider options and caches on its own.
const cliModel = (model: LanguageModelV4) => wrapLanguageModel({ model, middleware: [logCacheUsage] });

// serveTools lends each call's tools to the claude program.
export const cliBackend = (serveTools: ServeTools): ClaudeBackend => ({
  mode: 'cli',
  label: 'the claude program',
  // Looked up on the PATH it is given, since Bun may keep the PATH it started with.
  startupWarning: (env) => (Bun.which('claude', { PATH: env.PATH ?? '' }) ? undefined : CLAUDE_NOT_FOUND_HELP),
  chatModel: (modelId, tools) => cliModel(claudeCliModel(modelId, tools, { webTools: true, serveTools })),
  // Subagents only read, so they get none of claude's web tools.
  subagentModel: (modelId, tools) => cliModel(claudeCliModel(modelId, tools, { webTools: false, serveTools })),
  // claude's own web tools run inside its call, not as tools of the AI SDK's.
  providerTools: () => ({}),
});

export function claudeBackend(mode: ClaudeMode, serveTools: ServeTools): ClaudeBackend {
  return mode === 'api' ? apiBackend : cliBackend(serveTools);
}

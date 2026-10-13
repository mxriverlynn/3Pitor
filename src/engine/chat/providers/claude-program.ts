// Claude through the claude program on the operator's PATH, using their Claude subscription.
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { wrapLanguageModel } from 'ai';
import { CLAUDE_NOT_FOUND_HELP, claudeCliModel, type ServeTools } from '../claude-cli/claude-cli';
import { logCacheUsage } from './cache-usage';
import type { ProviderBackend } from './providers';

// No cache setting, since claude ignores call-level provider options and caches on its own.
const cliModel = (model: LanguageModelV4) => wrapLanguageModel({ model, middleware: [logCacheUsage] });

// serveTools lends each call's tools to the claude program.
export const cliBackend = (serveTools: ServeTools): ProviderBackend => ({
  id: 'claude-cli',
  label: 'the claude program',
  access: 'local',
  problem: (env, isOnPath) => (isOnPath('claude', env.PATH ?? '') ? undefined : CLAUDE_NOT_FOUND_HELP),
  chatModel: (modelId, tools) => cliModel(claudeCliModel(modelId, tools, { webTools: true, serveTools })),
  // Subagents only read, so they get none of claude's web tools.
  subagentModel: (modelId, tools) => cliModel(claudeCliModel(modelId, tools, { webTools: false, serveTools })),
  // claude's own web tools run inside its call, not as tools of the AI SDK's.
  providerTools: () => ({}),
});

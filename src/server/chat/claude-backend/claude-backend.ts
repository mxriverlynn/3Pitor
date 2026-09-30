// The ways chat can reach Claude, and everything that differs between them. This is the one place that knows which
// modes exist; agent.ts and server.ts ask the mode's backend and never check the mode themselves.
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel, ToolSet } from 'ai';
import type { ClaudeMode } from '../../../shared/wire';
import { CLAUDE_NOT_FOUND_HELP, claudeCliModel } from '../claude-cli/claude-cli';

export interface ClaudeBackend {
  readonly mode: ClaudeMode;
  // Completes "3pitor chat: claude via <label>".
  readonly label: string;
  // What startup prints when this mode cannot work as things stand, or undefined.
  startupWarning(env: Record<string, string | undefined>): string | undefined;
  // The model for the main chat, and for Task subagents; tools are the ones the call may use.
  chatModel(modelId: string, tools: ToolSet): LanguageModel;
  subagentModel(modelId: string, tools: ToolSet): LanguageModel;
  // Tools the provider runs itself, inside a model call.
  providerTools(): ToolSet;
}

// What to tell someone who started 3pitor without an API key, at startup and when a turn fails.
export const MISSING_API_KEY_HELP = `ANTHROPIC_API_KEY is not set, so chat won't work.

To fix it, create a key at https://console.anthropic.com/settings/keys, then start 3pitor with it:

  ANTHROPIC_API_KEY=sk-ant-... bun run server`;

export const apiBackend: ClaudeBackend = {
  mode: 'api',
  label: 'the Anthropic API',
  startupWarning: (env) => (env.ANTHROPIC_API_KEY ? undefined : MISSING_API_KEY_HELP),
  chatModel: (modelId) => anthropic(modelId),
  subagentModel: (modelId) => anthropic(modelId),
  // Run by Anthropic inside a model call, so they spend none of the turn's steps; each is capped per call instead.
  providerTools: () => ({
    web_search: anthropic.tools.webSearch_20250305({ maxUses: 10 }),
    web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 10 }),
  }),
};

export const cliBackend: ClaudeBackend = {
  mode: 'cli',
  label: 'the claude program',
  // Looked up on the PATH it is given, since Bun may keep the PATH it started with.
  startupWarning: (env) => (Bun.which('claude', { PATH: env.PATH ?? '' }) ? undefined : CLAUDE_NOT_FOUND_HELP),
  chatModel: (modelId, tools) => claudeCliModel(modelId, tools, { webTools: true }),
  // Subagents only read, so they get none of claude's web tools.
  subagentModel: (modelId, tools) => claudeCliModel(modelId, tools, { webTools: false }),
  // claude's own web tools run inside its call, not as tools of the AI SDK's.
  providerTools: () => ({}),
};

export function claudeBackend(mode: ClaudeMode): ClaudeBackend {
  return mode === 'api' ? apiBackend : cliBackend;
}

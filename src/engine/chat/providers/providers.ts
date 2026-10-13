// The services chat can reach, and everything that differs between them. This is the one place that knows which
// providers exist; agent.ts and the engine's startup ask the provider's backend and never check the provider themselves.
import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { ToolSet } from 'ai';
import type { ClaudeMode } from '../../../shared/wire';
import type { ServeTools } from '../claude-cli/claude-cli';
import { apiBackend } from './anthropic';
import { cliBackend } from './claude-program';

export { MISSING_API_KEY_HELP, apiBackend } from './anthropic';
export { cliBackend } from './claude-program';

// Whether an executable named `program` is on `path`, a list joined by the platform's delimiter. '' finds nothing.
// Must not throw. The host supplies it, since the engine does not search the disk outside the workspace.
export type IsOnPath = (program: string, path: string) => boolean;

export type ProviderId = 'claude-cli' | 'claude-api';

export interface ProviderBackend {
  readonly id: ProviderId;
  // Completes "3pitor chat: claude via <label>".
  readonly label: string;
  // Whether it runs on this computer, or is reached over the network with a key.
  readonly access: 'local' | 'api';
  // Why this provider cannot work as things stand, or undefined.
  problem(env: Record<string, string | undefined>, isOnPath: IsOnPath): string | undefined;
  // The model for the main chat, and for Task subagents; tools are the ones the call may use.
  chatModel(modelId: string, tools: ToolSet): LanguageModelV4;
  subagentModel(modelId: string, tools: ToolSet): LanguageModelV4;
  // Tools the provider runs itself, inside a model call.
  providerTools(): ToolSet;
}

// Every provider's backend, built once. The claude program's backend needs serveTools. Key order is the picker's order.
export function providerBackends(serveTools: ServeTools): Record<ProviderId, ProviderBackend> {
  return { 'claude-cli': cliBackend(serveTools), 'claude-api': apiBackend };
}

// How chat reaches Claude in the startup mode, until each session carries its own provider.
export function claudeBackend(mode: ClaudeMode, serveTools: ServeTools): ProviderBackend {
  return providerBackends(serveTools)[mode === 'api' ? 'claude-api' : 'claude-cli'];
}

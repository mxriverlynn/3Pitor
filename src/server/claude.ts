// Everything that knows the shape of the Claude Code provider: the settings shared by chat turns
// and jobs, the subagents defined in code, and where the provider reports its session id.
import type { UIMessageStreamWriter } from 'ai';
import { claudeCode, type ClaudeCodeSettings } from 'ai-sdk-provider-claude-code';
import { join } from 'node:path';
import type { HostEvent } from '../shared/wire';
import type { EventBus } from './events';
import { BUILD_DIR } from './workspace';
import { CODE_AGENTS } from './workspace-config';

// Subagents defined in code, in the shape Claude Code takes. background: false keeps a subagent inside
// the turn that started it. Subagents run in the background by default, so the turn can end first and
// the result leaks into the next turn.
export const CUSTOM_AGENTS: NonNullable<ClaudeCodeSettings['agents']> = Object.fromEntries(
  CODE_AGENTS.map(({ name, description, prompt, tools }) => [name, { description, prompt, tools, background: false }]),
);

export interface ClaudeOptions {
  workspace: string;
  model?: string;
}

// A Claude Code model for one chat turn or job. The base settings run in the document workspace,
// load only that workspace's .claude/ config (skills, agents, commands), and report task events;
// the caller adds its own permission settings through overrides.
export function claudeModel(
  options: ClaudeOptions,
  events: EventBus,
  ownerId: string,
  overrides: ClaudeCodeSettings,
  writer?: UIMessageStreamWriter,
) {
  return claudeCode(options.model ?? 'haiku', {
    cwd: options.workspace,
    // The SDK cannot find its native claude binary from inside a compiled build, so the build ships it
    // next to the executable.
    ...(BUILD_DIR && { pathToClaudeCodeExecutable: join(BUILD_DIR, 'claude') }),
    // Keep every subagent and shell command inside the turn that started it. Without this the
    // model can background a subagent, end the turn early, and the result lands in the next turn.
    env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' },
    settingSources: ['project'],
    skills: 'all',
    agents: CUSTOM_AGENTS,
    onSdkMessage: (message) => {
      if (message.type !== 'system' || message.subtype !== 'init') return;
      const event: HostEvent = {
        type: 'init',
        sessionId: ownerId,
        skills: message.skills ?? [],
        agents: message.agents ?? [],
        slashCommands: message.slash_commands ?? [],
      };
      writer?.write({ type: 'data-init', data: event });
      events.emit(event);
    },
    onTaskEvent: (task) => {
      const event: HostEvent = {
        type: 'task',
        sessionId: ownerId,
        subtype: task.subtype,
        description: 'description' in task ? task.description : undefined,
        subagentType: 'subagentType' in task ? task.subagentType : undefined,
      };
      writer?.write({ type: 'data-task', data: event });
      events.emit(event);
    },
    ...overrides,
  });
}

// The Claude session id the provider reports for a finished step, used to resume the conversation.
export function claudeSessionIdOf(step: { providerMetadata?: Record<string, Record<string, unknown>> }): string | undefined {
  return step.providerMetadata?.['claude-code']?.sessionId as string | undefined;
}

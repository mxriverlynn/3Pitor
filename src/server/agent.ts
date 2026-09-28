// One chat turn's model, instructions, and tools. The chat turn adds its own call options (step
// limits, abort signals).
import { anthropic } from '@ai-sdk/anthropic';
import { LoadAPIKeyError, generateText, stepCountIs, tool, type LanguageModel, type ToolSet, type UIMessageStreamWriter } from 'ai';
import { z } from 'zod';
import type { HostEvent } from '../shared/wire';
import type { EventBus } from './events';
import { fileTools, type TurnTexts } from './tools';
import { loadWorkspaceConfig, type AgentDef, type Skill } from './workspace-config';

export interface AgentOptions {
  workspace: string;
  model?: string;
}

export const DEFAULT_MODEL = 'claude-sonnet-5';

// Shortcuts for the latest model of each size.
export const MODEL_ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5-5',
};

// What to tell someone who started 3pitor without an API key, at startup and when a turn fails.
export const MISSING_API_KEY_HELP = `ANTHROPIC_API_KEY is not set, so chat won't work.

To fix it, create a key at https://console.anthropic.com/settings/keys, then start 3pitor with it:

  ANTHROPIC_API_KEY=sk-ant-... bun run server`;

// A model error as one readable message: the fix for a missing API key, or the error's own message.
export function modelErrorMessage(error: unknown): string {
  if (LoadAPIKeyError.isInstance(error)) return MISSING_API_KEY_HELP;
  return error instanceof Error ? error.message : String(error);
}

// The alias's model id, or the input unchanged, or DEFAULT_MODEL when undefined or empty.
export function resolveModelId(model: string | undefined): string {
  if (!model) return DEFAULT_MODEL;
  return MODEL_ALIASES[model] ?? model;
}

// Reads the workspace config on every call, so a skill added between turns shows up on the next one.
export async function agentSettings(
  options: AgentOptions,
  events: EventBus,
  ownerId: string,
  turn: TurnTexts,
  writer?: UIMessageStreamWriter,
): Promise<{ model: LanguageModel; instructions: string; tools: ToolSet }> {
  const config = await loadWorkspaceConfig(options.workspace);
  const model = anthropic(resolveModelId(options.model));
  const files = fileTools(options.workspace, turn);
  const report = (event: TaskEvent) => {
    writer?.write({ type: 'data-task', data: event });
    events.emit(event);
  };
  return {
    model,
    instructions: instructionsFor(config.skills),
    tools: { ...files, Task: taskTool(config.agents, model, files, ownerId, report) },
  };
}

type TaskEvent = Extract<HostEvent, { type: 'task' }>;

// Runs a subagent as a nested model call with only its read tools. The turn waits for the call, so a
// subagent cannot outlive the turn that started it.
function taskTool(
  agents: AgentDef[],
  model: LanguageModel,
  files: ReturnType<typeof fileTools>,
  ownerId: string,
  report: (event: TaskEvent) => void,
) {
  // Never empty, because CODE_AGENTS always has the title-writer.
  const names = agents.map((a) => a.name) as [string, ...string[]];
  return tool({
    description: `Hand a task to a subagent and get back its reply. Available subagents:\n${agents.map((a) => `- ${a.name}: ${a.description}`).join('\n')}`,
    inputSchema: z.object({ subagent_type: z.enum(names), description: z.string(), prompt: z.string() }),
    execute: async ({ subagent_type, description, prompt }, { abortSignal }) => {
      const agent = agents.find((a) => a.name === subagent_type)!;
      const task = { type: 'task', sessionId: ownerId, description, subagentType: subagent_type } as const;
      report({ ...task, subtype: 'task_started' });
      try {
        const result = await generateText({
          model,
          instructions: agent.prompt,
          prompt,
          tools: Object.fromEntries(agent.tools.map((name) => [name, files[name]])),
          stopWhen: stepCountIs(10),
          abortSignal,
        });
        return result.text;
      } finally {
        report({ ...task, subtype: 'task_notification' });
      }
    },
  });
}

function instructionsFor(skills: Skill[]): string {
  const base = `You are the writing assistant inside 3pitor, an editor for blog posts written in markdown. The user's posts are files in the workspace folder. Every file path you give a tool is relative to that folder; paths outside it are refused.
Read a file before you change it. Use Edit to change part of a post and Write to create or replace a whole post. Only markdown (.md) posts can be changed. Your changes appear in the user's editor as unsaved edits, and the user reviews and saves them.`;
  // Never empty, because the app's own skills are always listed.
  const lines = skills.map((s) => `- ${s.name} (${s.path}): ${s.description}`);
  return `${base}

Skills. When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly. Links inside a skill are relative to its SKILL.md's folder; Read them with the same prefix.
${lines.join('\n')}`;
}

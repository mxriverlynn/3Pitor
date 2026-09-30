// One chat turn's model, instructions, and tools. The chat turn adds its own call options (step
// limits, abort signals).
import { LoadAPIKeyError, generateText, stepCountIs, tool, type LanguageModel, type ToolSet, type UIMessageStreamWriter } from 'ai';
import { z } from 'zod';
import type { ClaudeMode, HostEvent, TurnProgress } from '../../../shared/wire';
import type { EventBus } from '../../events/events';
import { MISSING_API_KEY_HELP, claudeBackend } from '../claude-backend/claude-backend';
import { editedTexts, fileTools, type TurnTexts } from '../tools/tools';
import { loadWorkspaceConfig, type AgentDef, type Skill } from '../../workspace-config/workspace-config';
// The fixed part of the main prompt. Editing it needs a server restart in development and a rebuild for the binary.
import systemPrompt from './system-prompt.md' with { type: 'text' };

export interface AgentOptions {
  workspace: string;
  model?: string;
  // How chat reaches Claude, decided once at startup.
  claude: ClaudeMode;
}

export const DEFAULT_MODEL = 'claude-sonnet-5';

// Shortcuts for the latest model of each size.
export const MODEL_ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5-5',
};

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
  const backend = claudeBackend(options.claude);
  const id = resolveModelId(options.model);
  // Transient: the turn's `data-session` part carries the final edits and highlights for the record.
  const progress = () => {
    const data: TurnProgress = { edited: editedTexts(turn), highlights: turn.highlights };
    writer?.write({ type: 'data-progress', data, transient: true });
  };
  const files = fileTools(options.workspace, turn, progress);
  const report = (event: TaskEvent) => {
    writer?.write({ type: 'data-task', data: event });
    events.emit(event);
  };
  const tools: ToolSet = {
    ...files,
    Task: taskTool(config.agents, backend.subagentModel(id, files), files, ownerId, report),
    ...backend.providerTools(),
  };
  return { model: backend.chatModel(id, tools), instructions: instructionsFor(config.skills), tools };
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

const SKILLS_INTRO =
  "When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly. Links inside a skill are relative to its SKILL.md's folder; Read them with the same prefix.";

// The fixed prompt, then the skills. trimEnd() absorbs the file's trailing newline, so an editor's end-of-file
// setting cannot change the join.
function instructionsFor(skills: Skill[]): string {
  // Never empty, because the app's own skills are always listed.
  const lines = skills.map((s) => `- ${s.name} (${s.path}): ${s.description}`);
  return `${systemPrompt.trimEnd()}\n\n<skills>\n${SKILLS_INTRO}\n${lines.join('\n')}\n</skills>`;
}

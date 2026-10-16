// One chat turn's model and tools. The model carries the turn's instructions, so the chat turn passes none of its
// own; it adds only its call options (step limits, abort signals).
import {
  LoadAPIKeyError,
  defaultInstructionsMiddleware,
  generateText,
  stepCountIs,
  tool,
  wrapLanguageModel,
  type LanguageModel,
  type SystemModelMessage,
  type ToolSet,
  type UIMessageStreamWriter,
} from 'ai';
import { z } from 'zod';
import type { HostEvent, ModelSelection, TurnProgress } from '../../../shared/wire';
import type { EventBus } from '../../events/events';
import type { FileSystem } from '../../../file-system/file-system';
import type { PostStore } from '../../../posts/posts';
import type { ProviderBackend } from '../providers/providers';
import { editedTexts, fileTools, type TurnTexts } from '../tools/tools';
import { loadWorkspaceConfig, type AgentDef, type AppSkillFiles, type Skill } from '../../workspace-config/workspace-config';
// The fixed part of the main prompt. Editing it needs a server restart in development and a rebuild for the binary.
import { SYSTEM_PROMPT } from './system-prompt';

export interface AgentOptions {
  fileSystem: FileSystem;
  // The posts the file tools read and list.
  posts: PostStore;
  // The app's own skills, which the model lists and Reads through APP_SKILL_PREFIX.
  appSkillFiles: AppSkillFiles;
}

// A model error as one readable message: `help` for a missing API key when there is some, which says how to fix it
// for the session's provider, or the error's own message.
export function modelErrorMessage(error: unknown, help?: string): string {
  if (LoadAPIKeyError.isInstance(error) && help) return help;
  return error instanceof Error ? error.message : String(error);
}

// Reads the workspace config on every call, so a skill added between turns shows up on the next one.
// The model is the selection's, built by its provider's backend.
export async function agentSettings(
  options: AgentOptions,
  backend: ProviderBackend,
  selection: ModelSelection,
  events: EventBus,
  ownerId: string,
  turn: TurnTexts,
  writer?: UIMessageStreamWriter,
): Promise<{ model: LanguageModel; tools: ToolSet }> {
  const config = await loadWorkspaceConfig(options.fileSystem, options.appSkillFiles);
  // Transient: the turn's `data-session` part carries the final edits and highlights for the record.
  const progress = () => {
    const data: TurnProgress = { edited: editedTexts(turn), highlights: turn.highlights };
    writer?.write({ type: 'data-progress', data, transient: true });
  };
  const files = fileTools(options.fileSystem, options.posts, options.appSkillFiles, turn, progress);
  const report = (event: TaskEvent) => {
    writer?.write({ type: 'data-task', data: event });
    events.emit(event);
  };
  const tools: ToolSet = {
    ...files,
    Task: taskTool(config.agents, backend.subagentModel(selection.model, files), files, ownerId, report),
    ...backend.providerTools(),
  };
  const instructions = defaultInstructionsMiddleware({ instructions: instructionsFor(config.skills) });
  const model = backend.chatModel(selection.model, tools, selection.thinking);
  return { model: wrapLanguageModel({ model, middleware: instructions }), tools };
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

// The fixed prompt, marked for caching, then the skills, which can change between turns. Keeping them apart means a
// skills change leaves the fixed prompt's cache intact. trimEnd() absorbs the file's trailing newline, so an editor's
// end-of-file setting cannot change the prompt.
function instructionsFor(skills: Skill[]): SystemModelMessage[] {
  // Never empty, because the app's own skills are always listed.
  const lines = skills.map((s) => `- ${s.name} (${s.path}): ${s.description}`);
  return [
    { role: 'system', content: SYSTEM_PROMPT.trimEnd(), providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
    { role: 'system', content: `<skills>\n${SKILLS_INTRO}\n${lines.join('\n')}\n</skills>` },
  ];
}

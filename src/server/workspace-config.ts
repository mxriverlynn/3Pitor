// The skills and agents a workspace defines in its .claude/ folder, plus the agents defined in code.
// The workspace-config route lists them, and agent.ts tells the model about them on every turn.
import { join } from 'node:path';

export interface Skill {
  name: string;
  description: string;
  // Workspace-relative, such as '.claude/skills/doc-stats/SKILL.md'.
  path: string;
}

export interface AgentDef {
  name: string;
  description: string;
  prompt: string;
  tools: ('Read' | 'Glob')[];
}

export interface WorkspaceConfig {
  skills: Skill[];
  agents: AgentDef[];
}

// Agents defined in code rather than in the workspace's .claude/agents folder.
export const CODE_AGENTS: AgentDef[] = [
  {
    name: 'title-writer',
    description: 'Suggests a better title for a markdown document. Use when asked for a title suggestion.',
    prompt: 'Read the document and reply with one line: "TITLE SUGGESTION: <title>". Do not edit files.',
    tools: ['Read'],
  },
];

// One broken file never fails the caller: a file whose frontmatter does not parse is skipped, and a
// field of the wrong type counts as missing.
export async function loadWorkspaceConfig(workspace: string): Promise<WorkspaceConfig> {
  const skills: Skill[] = [];
  for (const path of await scan(workspace, '.claude/skills/*/SKILL.md')) {
    const file = await readMarkdown(workspace, path);
    if (!file) continue;
    skills.push({ name: path.split('/')[2], description: stringField(file.data.description), path });
  }
  const agents: AgentDef[] = [];
  for (const path of await scan(workspace, '.claude/agents/*.md')) {
    const file = await readMarkdown(workspace, path);
    if (!file) continue;
    const { tools } = file.data;
    agents.push({
      name: path.split('/')[2].replace(/\.md$/, ''),
      description: stringField(file.data.description),
      prompt: file.body.trim(),
      tools: typeof tools === 'string' ? tools.split(',').map((t) => t.trim()).filter(isAgentTool) : ['Read', 'Glob'],
    });
  }
  return { skills: skills.sort(byName), agents: [...agents.sort(byName), ...CODE_AGENTS] };
}

const stringField = (value: unknown) => (typeof value === 'string' ? value : '');

// Subagents only read, so any other tool an agent file asks for is dropped.
const isAgentTool = (name: string): name is AgentDef['tools'][number] => name === 'Read' || name === 'Glob';

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

const scan = (workspace: string, pattern: string) =>
  Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: workspace, onlyFiles: true, dot: true }));

// Splits a file into its YAML frontmatter (between a first line of --- and the next line of ---) and its
// body, or returns undefined when the frontmatter is missing, unclosed, or does not parse.
async function readMarkdown(workspace: string, path: string) {
  const lines = (await Bun.file(join(workspace, path)).text()).split('\n');
  const close = lines.indexOf('---', 1);
  if (lines[0] !== '---' || close < 0) return undefined;
  let data: unknown;
  try {
    data = Bun.YAML.parse(lines.slice(1, close).join('\n'));
  } catch {
    return undefined;
  }
  const fields = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return { data: fields, body: lines.slice(close + 1).join('\n') };
}

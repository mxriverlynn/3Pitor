// The skills and agents a workspace defines in its .claude/ folder, plus the app's own skills and the
// agents defined in code.
// The engine's workspaceConfig.names() lists them, and agent.ts tells the model about them on every turn.
import { join } from 'node:path';
import { normalize } from 'node:path/posix';
import { appSkillFiles } from './app-skills.macro' with { type: 'macro' };

export interface Skill {
  name: string;
  description: string;
  // Workspace-relative, such as '.claude/skills/doc-stats/SKILL.md', or an app skill's path starting with
  // APP_SKILL_PREFIX, such as '3pitor://skills/collaborative-editing/SKILL.md'.
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

// The app's own skills from src/skills/, embedded when the server is bundled; keys are relative to that folder.
export const APP_SKILL_FILES: Record<string, string> = appSkillFiles();

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
  // A workspace skill replaces the app skill of the same name.
  const apps = appSkills(APP_SKILL_FILES).filter((app) => !skills.some((s) => s.name === app.name));
  return { skills: [...skills, ...apps].sort(byName), agents: [...agents.sort(byName), ...CODE_AGENTS] };
}

// The path prefix the model reads the app's skill files through. It never reaches the disk.
export const APP_SKILL_PREFIX = '3pitor://skills/';

// The embedded text of an app skill file, or undefined for a path without APP_SKILL_PREFIX. Throws for
// a file the app does not have, which includes a path that climbs out of the skills with '..'.
export function appSkillText(filePath: string): string | undefined {
  if (!filePath.startsWith(APP_SKILL_PREFIX)) return undefined;
  const path = normalize(filePath.slice(APP_SKILL_PREFIX.length));
  if (path.startsWith('..') || !Object.hasOwn(APP_SKILL_FILES, path)) throw new Error(`${filePath} does not exist`);
  return APP_SKILL_FILES[path];
}

// The skills among the app's skill files: each <name>/SKILL.md whose frontmatter parses.
export function appSkills(files: Record<string, string>): Skill[] {
  const skills: Skill[] = [];
  for (const [path, text] of Object.entries(files)) {
    const [name, file, ...rest] = path.split('/');
    if (file !== 'SKILL.md' || rest.length) continue;
    const parsed = parseFrontmatter(text);
    if (!parsed) continue;
    skills.push({ name, description: stringField(parsed.data.description), path: APP_SKILL_PREFIX + path });
  }
  return skills;
}

const stringField = (value: unknown) => (typeof value === 'string' ? value : '');

// Subagents only read, so any other tool an agent file asks for is dropped.
const isAgentTool = (name: string): name is AgentDef['tools'][number] => name === 'Read' || name === 'Glob';

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

const scan = (workspace: string, pattern: string) =>
  Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: workspace, onlyFiles: true, dot: true }));

// Reads a workspace file and splits its frontmatter from its body.
async function readMarkdown(workspace: string, path: string) {
  return parseFrontmatter(await Bun.file(join(workspace, path)).text());
}

// Splits a file into its YAML frontmatter (between a first line of --- and the next line of ---) and its
// body, or returns undefined when the frontmatter is missing, unclosed, or does not parse.
export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } | undefined {
  const lines = text.split('\n');
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

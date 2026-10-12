// The skills and agents a workspace defines in its .claude/ folder, plus the app's own skills and the
// agents defined in code.
// The engine's workspaceConfig.names() lists them, and agent.ts tells the model about them on every turn.
import { normalize } from 'node:path/posix';
import { parse } from 'yaml';
import type { FileSystem } from '../../file-system/file-system';

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

// Each app skill file's full text, keyed by its '/'-separated path under the skills folder: no leading '/', no '..'
// segments, hidden names excluded. Example: { 'collaborative-editing/SKILL.md': '---\nname: collaborative-editing\n...' }
// The host supplies it; 3pitor's embeds src/skills/ when the app is bundled.
export type AppSkillFiles = Readonly<Record<string, string>>;

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
export async function loadWorkspaceConfig(fileSystem: FileSystem, appSkillFiles: AppSkillFiles): Promise<WorkspaceConfig> {
  const skills: Skill[] = [];
  for (const path of await scan(fileSystem, '.claude/skills/*/SKILL.md')) {
    const file = await readMarkdown(fileSystem, path);
    if (!file) continue;
    skills.push({ name: path.split('/')[2], description: stringField(file.data.description), path });
  }
  const agents: AgentDef[] = [];
  for (const path of await scan(fileSystem, '.claude/agents/*.md')) {
    const file = await readMarkdown(fileSystem, path);
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
  const apps = appSkills(appSkillFiles).filter((app) => !skills.some((s) => s.name === app.name));
  return { skills: [...skills, ...apps].sort(byName), agents: [...agents.sort(byName), ...CODE_AGENTS] };
}

// The path prefix the model reads the app's skill files through. It never reaches the disk.
export const APP_SKILL_PREFIX = '3pitor://skills/';

// The text of an app skill file, or undefined for a path without APP_SKILL_PREFIX. Throws for a file the
// app does not have, which includes a path that climbs out of the skills with '..'.
export function appSkillText(appSkillFiles: AppSkillFiles, filePath: string): string | undefined {
  if (!filePath.startsWith(APP_SKILL_PREFIX)) return undefined;
  const path = normalize(filePath.slice(APP_SKILL_PREFIX.length));
  if (path.startsWith('..') || !Object.hasOwn(appSkillFiles, path)) throw new Error(`${filePath} does not exist`);
  return appSkillFiles[path];
}

// The skills among the app's skill files: each <name>/SKILL.md whose frontmatter parses.
export function appSkills(files: AppSkillFiles): Skill[] {
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

// Sorted, so skills and agents come back in the same order on every backend.
const scan = async (fileSystem: FileSystem, pattern: string) => (await fileSystem.glob(pattern, { dot: true })).sort();

// Reads a workspace file and splits its frontmatter from its body.
async function readMarkdown(fileSystem: FileSystem, path: string) {
  return parseFrontmatter(await fileSystem.read(path));
}

// Splits a file into its YAML frontmatter (between a first line of --- and the next line of ---) and its
// body, or returns undefined when the frontmatter is missing, unclosed, or does not parse.
export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } | undefined {
  const lines = text.split('\n');
  const close = lines.indexOf('---', 1);
  if (lines[0] !== '---' || close < 0) return undefined;
  let data: unknown;
  try {
    // uniqueKeys: false lets a duplicated key take its last value, rather than failing the whole file.
    data = parse(lines.slice(1, close).join('\n'), { uniqueKeys: false });
  } catch {
    return undefined;
  }
  const fields = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return { data: fields, body: lines.slice(close + 1).join('\n') };
}

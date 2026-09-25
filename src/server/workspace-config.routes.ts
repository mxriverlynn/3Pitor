// Skills and agents this workspace or app defines, so a UI can tell them apart from Claude Code's built-ins.
import { Hono } from 'hono';
import { join } from 'node:path';
import { CUSTOM_AGENTS } from './claude';

export function workspaceConfigRoutes(workspace: string): Hono {
  const app = new Hono();

  app.get('/api/workspace-config', async (c) => {
    const scan = (pattern: string) => Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: join(workspace, '.claude'), onlyFiles: true }));
    const skills = (await scan('skills/*/SKILL.md')).map((p) => p.split('/')[1]);
    const agents = (await scan('agents/*.md')).map((p) => p.split('/')[1].replace(/\.md$/, ''));
    return c.json({ skills, agents: [...agents, ...Object.keys(CUSTOM_AGENTS)] });
  });

  return app;
}

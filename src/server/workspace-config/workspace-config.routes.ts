// The skills and agents this workspace or app defines, by name.
import { Hono } from 'hono';
import { loadWorkspaceConfig } from './workspace-config';

export function workspaceConfigRoutes(workspace: string): Hono {
  const app = new Hono();

  app.get('/api/workspace-config', async (c) => {
    const config = await loadWorkspaceConfig(workspace);
    return c.json({ skills: config.skills.map((s) => s.name), agents: config.agents.map((a) => a.name) });
  });

  return app;
}

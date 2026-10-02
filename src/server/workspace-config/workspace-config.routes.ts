// The skills and agents this workspace or app defines, by name.
import { Hono } from 'hono';
import type { Engine } from '../../engine/engine';

export function workspaceConfigRoutes(workspaceConfig: Engine['workspaceConfig']): Hono {
  const app = new Hono();

  app.get('/api/workspace-config', async (c) => c.json(await workspaceConfig.names()));

  return app;
}

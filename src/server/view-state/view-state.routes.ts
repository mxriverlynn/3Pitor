// The editor's stored view over REST.
import { Hono } from 'hono';
import type { ViewState } from '../../shared/wire';
import { loadViewState, saveViewState } from './view-state';

export function viewStateRoutes(workspace: string): Hono {
  const app = new Hono();

  app.get('/api/view-state', async (c) => c.json(await loadViewState(workspace)));

  // The page is the only writer, and restoring drops any piece it cannot use, so the body is stored as sent.
  app.put('/api/view-state', async (c) => {
    try {
      await saveViewState(workspace, await c.req.json<ViewState>());
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  return app;
}

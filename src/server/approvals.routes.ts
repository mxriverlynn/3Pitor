// Answering tool-use approvals over REST. Clients can also answer over the event socket (events.routes.ts).
import { Hono } from 'hono';
import type { Approvals } from './approvals';

export function approvalRoutes(approvals: Approvals): Hono {
  const app = new Hono();

  app.post('/api/approvals/:id', async (c) => {
    const { allow } = await c.req.json<{ allow: boolean }>();
    const found = approvals.resolve(c.req.param('id'), allow);
    return c.json({ ok: found }, found ? 200 : 404);
  });

  return app;
}

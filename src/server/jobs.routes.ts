// Background jobs over REST. Status changes are also pushed over the event socket.
import { Hono } from 'hono';
import type { Jobs } from './jobs';

export function jobRoutes(jobs: Jobs): Hono {
  const app = new Hono();

  app.post('/api/jobs', async (c) => {
    const { prompt, maxTurns, timeoutMs } = await c.req.json();
    return c.json(jobs.start(prompt, { maxTurns, timeoutMs }), 202);
  });

  app.get('/api/jobs/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    return job ? c.json(job) : c.json({ error: 'not found' }, 404);
  });

  app.post('/api/jobs/:id/cancel', (c) => c.json({ cancelled: jobs.cancel(c.req.param('id')) }));

  return app;
}

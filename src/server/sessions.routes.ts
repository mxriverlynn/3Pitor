// Chat sessions over REST, with the AI SDK UI message stream (SSE) for each chat turn.
import { Hono } from 'hono';
import { createUIMessageStreamResponse } from 'ai';
import type { Sessions } from './sessions';

export function sessionRoutes(sessions: Sessions): Hono {
  const app = new Hono();

  app.post('/api/sessions', (c) => c.json({ id: sessions.create().id }, 201));

  app.post('/api/sessions/:id/chat', async (c) => {
    const { text } = await c.req.json<{ text: string }>();
    try {
      return createUIMessageStreamResponse({ stream: sessions.chat(c.req.param('id'), text) });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 409);
    }
  });

  app.post('/api/sessions/:id/cancel', (c) => c.json({ cancelled: sessions.cancel(c.req.param('id')) }));

  return app;
}

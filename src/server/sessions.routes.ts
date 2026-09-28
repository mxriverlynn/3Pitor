// Chat sessions over REST, with the AI SDK UI message stream (SSE) for each chat turn.
import { Hono } from 'hono';
import { createUIMessageStreamResponse } from 'ai';
import type { Sessions } from './sessions';

export function sessionRoutes(sessions: Sessions): Hono {
  const app = new Hono();

  app.post('/api/sessions', (c) => c.json({ id: sessions.create().id }, 201));

  app.post('/api/sessions/:id/chat', async (c) => {
    const { text, openFile, documents } = await c.req.json<{ text: string; openFile?: unknown; documents?: unknown }>();
    // The file open in the editor, if the client sent one. Anything else runs the turn without it.
    const open = typeof openFile === 'string' && openFile !== '' ? openFile : undefined;
    // Unlike a bad openFile, bad documents are refused: running the turn from disk instead would have
    // the AI edit text the user no longer has, and merging that back would undo their typing.
    if (documents !== undefined && !isDocuments(documents)) {
      return c.json({ error: 'documents must map file names to markdown' }, 400);
    }
    try {
      return createUIMessageStreamResponse({ stream: sessions.chat(c.req.param('id'), { text, openFile: open, documents }) });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 409);
    }
  });

  app.post('/api/sessions/:id/cancel', (c) => c.json({ cancelled: sessions.cancel(c.req.param('id')) }));

  return app;
}

const isDocuments = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'string');

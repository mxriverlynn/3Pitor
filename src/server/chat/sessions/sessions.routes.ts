// Chat sessions over REST, with the AI SDK UI message stream (SSE) for each chat turn.
import { Hono } from 'hono';
import { createUIMessageStreamResponse } from 'ai';
import type { Engine } from '../../../engine/engine';
import type { CurrentSession } from '../../../shared/wire';

export function sessionRoutes(sessions: Engine['sessions']): Hono {
  const app = new Hono();

  app.get('/api/sessions/current', (c) => c.json<CurrentSession>(sessions.current()));

  app.post('/api/sessions', async (c) => {
    try {
      return c.json({ id: await sessions.create() }, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  app.post('/api/sessions/:id/chat', async (c) => {
    const { text, openFile, documents } = await c.req.json<{ text: string; openFile?: unknown; documents?: unknown }>();
    // The file open in the editor, if the client sent one. Anything else runs the turn without it.
    const open = typeof openFile === 'string' && openFile !== '' ? openFile : undefined;
    // Unlike a bad openFile, bad documents are refused: running the turn from disk instead would have
    // the AI edit text the user no longer has, and merging that back would undo their typing.
    if (documents !== undefined && !isDocuments(documents)) {
      return c.json({ error: 'documents must map file names to markdown' }, 400);
    }
    // The engine refuses at once for an unknown session or a turn in progress; anything later arrives in the stream.
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

// Documents: maps each request to documents.ts, and each DocumentError to a 400 or 404 with a sentence the
// browser shows. Any other error stays Hono's plain-text 500.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ApiError, DocumentList, FolderCount } from '../../shared/wire';
import { countContents, createEntry, deleteEntry, DocumentError, listEntries, moveEntry, readDocument, writeDocument } from './documents';

const PutBody = z.object({ content: z.string() });
const CreateBody = z.object({ path: z.string(), kind: z.enum(['file', 'folder']) });
const MoveBody = z.object({ from: z.string(), to: z.string() });
const PathBody = z.object({ path: z.string() });

export function documentRoutes(workspace: string): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof DocumentError) return c.json<ApiError>({ error: error.message }, error.reason === 'not-found' ? 404 : 400);
    console.error(error);
    return c.text('Internal Server Error', 500);
  });

  app.get('/api/documents', async (c) => c.json<DocumentList>({ entries: await listEntries(workspace) }));

  app.get('/api/documents/:name', async (c) => {
    const name = c.req.param('name');
    return c.json({ name, content: await readDocument(workspace, name) });
  });

  app.put('/api/documents/:name', async (c) => {
    const { content } = await body(c, PutBody);
    await writeDocument(workspace, c.req.param('name'), content);
    return c.json({ ok: true });
  });

  app.post('/api/documents/create', async (c) => {
    const { path, kind } = await body(c, CreateBody);
    await createEntry(workspace, path, kind);
    return c.json({ ok: true });
  });

  app.post('/api/documents/move', async (c) => {
    const { from, to } = await body(c, MoveBody);
    await moveEntry(workspace, from, to);
    return c.json({ ok: true });
  });

  app.post('/api/documents/count', async (c) => {
    const { path } = await body(c, PathBody);
    return c.json<FolderCount>(await countContents(workspace, path));
  });

  app.post('/api/documents/delete', async (c) => {
    const { path } = await body(c, PathBody);
    await deleteEntry(workspace, path);
    return c.json({ ok: true });
  });

  return app;
}

// The request's JSON body, checked against its schema; a body that does not fit is a 400.
async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) throw new DocumentError('invalid', `the request body is not valid: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

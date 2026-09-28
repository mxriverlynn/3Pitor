// Documents: plain file reads and writes inside the workspace.
import { Hono } from 'hono';
import { relative, resolve } from 'node:path';

export function documentRoutes(workspace: string): Hono {
  const app = new Hono();

  function docPath(name: string): string {
    const path = resolve(workspace, name);
    if (relative(workspace, path).startsWith('..')) throw new Error('path escapes workspace');
    return path;
  }

  app.get('/api/documents', async (c) => {
    const names = await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: workspace }));
    return c.json({ documents: names.sort() });
  });

  app.get('/api/documents/:name', async (c) => {
    const file = Bun.file(docPath(c.req.param('name')));
    if (!(await file.exists())) return c.json({ error: 'not found' }, 404);
    return c.json({ name: c.req.param('name'), content: await file.text() });
  });

  app.put('/api/documents/:name', async (c) => {
    const { content } = await c.req.json<{ content: string }>();
    await Bun.write(docPath(c.req.param('name')), content);
    return c.json({ ok: true });
  });

  return app;
}

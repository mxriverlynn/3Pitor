// Thin Hono transport over AgentHost: REST for sessions, documents, approvals and jobs,
// the AI SDK UI message stream (SSE) for chat turns, and a Bun-native WebSocket for events.
import { Hono } from 'hono';
import { upgradeWebSocket, websocket } from 'hono/bun';
import { createUIMessageStreamResponse } from 'ai';
import { resolve, join, relative } from 'node:path';
import { cp, exists } from 'node:fs/promises';
import { AgentHost, CUSTOM_AGENTS } from './core/agent-host';
import homepage from '../ui/index.html';

// Paths are anchored to src/ so the scripts work from any working directory.
const SRC = resolve(import.meta.dir, '..');

const workspace = process.env.WORKSPACE ? resolve(process.env.WORKSPACE) : join(SRC, '.data/workspace');
if (!(await exists(workspace))) await cp(join(SRC, 'fixtures/workspace'), workspace, { recursive: true });
const host = new AgentHost({ workspace, model: process.env.MODEL ?? 'haiku' });
const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true, workspace, bun: Bun.version }));

// Documents: plain file reads and writes inside the workspace.
function docPath(name: string): string {
  const path = resolve(workspace, name);
  if (relative(workspace, path).startsWith('..')) throw new Error('path escapes workspace');
  return path;
}

// Skills and agents this workspace or app defines, so a UI can tell them apart from Claude Code's built-ins.
app.get('/api/workspace-config', async (c) => {
  const scan = (pattern: string) => Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: join(workspace, '.claude'), onlyFiles: true }));
  const skills = (await scan('skills/*/SKILL.md')).map((p) => p.split('/')[1]);
  const agents = (await scan('agents/*.md')).map((p) => p.split('/')[1].replace(/\.md$/, ''));
  return c.json({ skills, agents: [...agents, ...Object.keys(CUSTOM_AGENTS)] });
});

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

// Chat sessions.
app.post('/api/sessions', (c) => c.json({ id: host.createSession().id }, 201));

app.post('/api/sessions/:id/chat', async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  try {
    return createUIMessageStreamResponse({ stream: host.chat(c.req.param('id'), text) });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
});

app.post('/api/sessions/:id/cancel', (c) => c.json({ cancelled: host.cancel(c.req.param('id')) }));

app.post('/api/approvals/:id', async (c) => {
  const { allow } = await c.req.json<{ allow: boolean }>();
  const found = host.resolveApproval(c.req.param('id'), allow);
  return c.json({ ok: found }, found ? 200 : 404);
});

// Background jobs.
app.post('/api/jobs', async (c) => {
  const { prompt, maxTurns, maxBudgetUsd, timeoutMs } = await c.req.json();
  return c.json(host.startJob(prompt, { maxTurns, maxBudgetUsd, timeoutMs }), 202);
});

app.get('/api/jobs/:id', (c) => {
  const job = host.getJob(c.req.param('id'));
  return job ? c.json(job) : c.json({ error: 'not found' }, 404);
});

app.post('/api/jobs/:id/cancel', (c) => c.json({ cancelled: host.cancelJob(c.req.param('id')) }));

// Event socket: every host event (approvals, tasks, job status) for any UI that listens.
app.get(
  '/ws/events',
  upgradeWebSocket(() => {
    let unsubscribe: (() => void) | undefined;
    return {
      onOpen: (_event, ws) => {
        unsubscribe = host.subscribe((event) => ws.send(JSON.stringify(event)));
      },
      onMessage: (event, _ws) => {
        // Clients can answer approvals over the socket as well as over REST.
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'approval-response') host.resolveApproval(msg.approvalId, msg.allow);
      },
      onClose: () => unsubscribe?.(),
    };
  }),
);

const port = Number(process.env.PORT ?? 3737);
Bun.serve({
  port,
  // Bun bundles the React UI straight from its HTML entry point.
  routes: { '/': homepage },
  development: process.env.NODE_ENV !== 'production',
  fetch: app.fetch,
  websocket,
  // Bun closes idle HTTP connections after 10s by default; agent turns can pause longer than that.
  idleTimeout: 255,
});
console.log(`aiditor spike listening on http://localhost:${port} (workspace: ${join(workspace)})`);

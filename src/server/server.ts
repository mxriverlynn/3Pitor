// Entry point: sets up the workspace, wires the agent host, and mounts each feature's routes on one
// Hono app. REST for sessions and documents, the AI SDK UI message stream (SSE)
// for chat turns, and a Bun-native WebSocket for events.
import { Hono } from 'hono';
import { websocket } from 'hono/bun';
import { join } from 'node:path';
import homepage from '../ui/index.html';
import { claudeBackend } from './chat/claude-backend/claude-backend';
import { createAgentHost } from './agent-host';
import { USAGE, VERSION, parseCommandLine } from './command-line';
import { documentRoutes } from './documents/documents.routes';
import { eventSocket } from './events/events.routes';
import { sessionRoutes } from './chat/sessions/sessions.routes';
import { viewStateRoutes } from './view-state/view-state.routes';
import { workspaceConfigRoutes } from './workspace-config/workspace-config.routes';
import { chooseWorkspace } from './workspace/workspace';

const { target, claude } = commandLine();
const workspace = await chooseWorkspace(target);
// MODEL takes a full model id or a shortcut (haiku, sonnet, opus); agent.ts picks the default.
const host = createAgentHost({ workspace, model: process.env.MODEL, claude });
// Brings back the stored chat, so GET /api/sessions/current always has a session to answer with.
await host.sessions.load();
const backend = claudeBackend(claude);
console.log(`3pitor chat: claude via ${backend.label}`);
const warning = backend.startupWarning(process.env);
if (warning) console.warn(`\n${warning}\n`);

const app = new Hono()
  .get('/api/health', (c) => c.json({ ok: true, workspace, bun: Bun.version }))
  .route('/', workspaceConfigRoutes(workspace))
  .route('/', documentRoutes(workspace))
  .route('/', sessionRoutes(host.sessions))
  .route('/', viewStateRoutes(workspace))
  .route('/', eventSocket(host.events));

// Port 0 asks the OS for any free port, so several instances can run side by side.
// Set PORT to pin one.
const server = Bun.serve({
  port: Number(process.env.PORT ?? 0),
  // Bun bundles the React UI straight from its HTML entry point.
  routes: { '/': homepage },
  development: process.env.NODE_ENV !== 'production',
  fetch: app.fetch,
  websocket,
  // Bun closes idle HTTP connections after 10s by default; agent turns can pause longer than that.
  idleTimeout: 255,
});
// check.ts reads the URL from this line; keep its "listening on <url>" shape.
console.log(`3pitor listening on ${server.url.origin} (workspace: ${join(workspace)})`);

// Open the UI in the default browser. Set OPEN_BROWSER=0 to skip it (the check script does).
if (process.env.OPEN_BROWSER !== '0') {
  const url = server.url.origin;
  const command =
    process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url];
  try {
    Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' });
  } catch {
    console.log(`Could not open a browser; visit ${url}`);
  }
}

// A bad flag stops startup, so a forced mode is never silently ignored. --version and --help print and exit before
// anything starts.
function commandLine() {
  let line;
  try {
    line = parseCommandLine(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`3pitor: ${error instanceof Error ? error.message : error}\n${USAGE}`);
    process.exit(2);
  }
  if ('print' in line) {
    console.log(line.print === 'version' ? `3pitor ${VERSION}` : USAGE);
    process.exit(0);
  }
  return line;
}

// The HTTP and WebSocket face of 3pitor: one Hono app with every feature's routes, the page, and the event socket,
// served by Bun. REST for documents and sessions, the AI SDK UI message stream (SSE) for chat turns, and a Bun-native
// WebSocket for events. Takes a started engine; reads no environment and prints nothing.
import { Hono } from 'hono';
import { websocket } from 'hono/bun';
import homepage from '../ui/index.html';
import type { Engine } from '../engine/engine';
import { sessionRoutes } from './chat/sessions/sessions.routes';
import { documentRoutes } from './documents/documents.routes';
import { eventSocket } from './events/events.routes';
import { viewStateRoutes } from './view-state/view-state.routes';
import { workspaceConfigRoutes } from './workspace-config/workspace-config.routes';

// The MCP loopback endpoint the engine is handed, so the claude program can call 3pitor's tools.
export { serveTools } from './chat/mcp-endpoint/mcp-endpoint';

export interface ServerOptions {
  // 0 asks the OS for any free port.
  port: number;
  development: boolean;
}

// Nothing stops the server today, so it has no stop().
export interface StartedServer {
  readonly url: URL;
}

export function startServer(engine: Engine, { port, development }: ServerOptions): StartedServer {
  const app = new Hono()
    .get('/api/health', (c) => c.json({ ok: true, workspace: engine.workspace, bun: Bun.version }))
    .route('/', workspaceConfigRoutes(engine.workspaceConfig))
    .route('/', documentRoutes(engine.documents))
    .route('/', sessionRoutes(engine.sessions))
    .route('/', viewStateRoutes(engine.viewState))
    .route('/', eventSocket(engine.events));
  const server = Bun.serve({
    port,
    // Bun bundles the React UI straight from its HTML entry point.
    routes: { '/': homepage },
    development,
    fetch: app.fetch,
    websocket,
    // Bun closes idle HTTP connections after 10s by default; agent turns can pause longer than that.
    idleTimeout: 255,
  });
  return { url: server.url };
}

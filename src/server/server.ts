// The HTTP and WebSocket face of 3pitor: one Hono app with every feature's routes, the page, and the event socket,
// served by Bun. REST for posts, documents, and sessions, the AI SDK UI message stream (SSE) for chat turns, and a Bun-native
// WebSocket for events. Takes a started engine; reads no environment and prints nothing.
import { Hono } from 'hono';
import { websocket } from 'hono/bun';
import homepage from '../ui/index.html';
import type { Engine } from '../engine/engine';
import { modelRoutes } from './chat/models/models.routes';
import { sessionRoutes } from './chat/sessions/sessions.routes';
import { documentRoutes } from './documents/documents.routes';
import { eventSocket } from './events/events.routes';
import { postRoutes } from './posts/posts.routes';
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
    .route('/', postRoutes(engine.posts))
    .route('/', sessionRoutes(engine.sessions))
    .route('/', modelRoutes(engine.models))
    .route('/', viewStateRoutes(engine.viewState))
    .route('/', eventSocket(engine.events));
  const server = Bun.serve({
    // This machine only: the API has no sign-in, so another machine on the network must not reach it.
    hostname: '127.0.0.1',
    port,
    // Bun bundles the React UI straight from its HTML entry point.
    routes: { '/': homepage },
    development,
    fetch: (request, server) => (sameMachine(request, server.port!) ? app.fetch(request, server) : new Response('Forbidden', { status: 403 })),
    websocket,
    // Bun closes idle HTTP connections after 10s by default; agent turns can pause longer than that.
    idleTimeout: 255,
  });
  return { url: server.url };
}

// Whether a request reached this server by its own name, and, when a page sent it, came from the app's own page. A page
// whose name was rebound to this machine carries its own Host, and another site's page its own Origin, so both are
// refused before any route or the event socket sees them. Delete and save stay DELETE and PUT, and no CORS header is
// ever sent, so a browser never lets another site send those either.
function sameMachine(request: Request, port: number): boolean {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const origin = request.headers.get('origin');
  return hosts.includes(request.headers.get('host') ?? '') && (origin === null || hosts.some((host) => origin === `http://${host}`));
}

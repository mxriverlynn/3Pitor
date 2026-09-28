// Event socket: every host event (subagent tasks, finished turns) for any UI that listens.
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import type { EventBus } from './events';

export function eventSocket(events: EventBus): Hono {
  const app = new Hono();

  app.get(
    '/ws/events',
    upgradeWebSocket(() => {
      let unsubscribe: (() => void) | undefined;
      return {
        onOpen: (_event, ws) => {
          unsubscribe = events.subscribe((event) => ws.send(JSON.stringify(event)));
        },
        onClose: () => unsubscribe?.(),
      };
    }),
  );

  return app;
}

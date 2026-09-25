// Event socket: every host event (approvals, tasks, job status) for any UI that listens.
// It is the one transport shared by several features, so it also takes approval answers.
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import type { ClientMessage } from '../shared/wire';
import type { Approvals } from './approvals';
import type { EventBus } from './events';

export function eventSocket(events: EventBus, approvals: Approvals): Hono {
  const app = new Hono();

  app.get(
    '/ws/events',
    upgradeWebSocket(() => {
      let unsubscribe: (() => void) | undefined;
      return {
        onOpen: (_event, ws) => {
          unsubscribe = events.subscribe((event) => ws.send(JSON.stringify(event)));
        },
        onMessage: (event, _ws) => {
          // Clients can answer approvals over the socket as well as over REST.
          const msg = JSON.parse(String(event.data)) as ClientMessage;
          if (msg.type === 'approval-response') approvals.resolve(msg.approvalId, msg.allow);
        },
        onClose: () => unsubscribe?.(),
      };
    }),
  );

  return app;
}

// The shapes that cross the wire between the server and its clients (the UI and the check script).
// Types only, with no imports, so the browser bundle can import it with `import type`.

export type HostEvent =
  | { type: 'approval-request'; sessionId: string; approvalId: string; toolName: string; title: string; input: unknown }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string; allow: boolean }
  | { type: 'task'; sessionId: string; subtype: 'task_started' | 'task_notification'; description: string; subagentType: string }
  | { type: 'turn-finished'; sessionId: string; aborted: boolean };

// The body of POST /api/sessions/:id/chat.
export interface ChatRequest {
  text: string;
  // The document open in the editor.
  openFile?: string;
  // Every editable document the browser holds, by name, as markdown: what the user sees, saved or not.
  documents?: Record<string, string>;
}

// The data of the `data-session` part that ends a chat turn's stream.
export interface SessionData {
  aborted: boolean;
  // The final markdown of every post the turn edited, by name, in the order they last changed; {} when aborted.
  edited: Record<string, string>;
}

// Messages a client may send over the event socket.
export type ClientMessage = { type: 'approval-response'; approvalId: string; allow: boolean };

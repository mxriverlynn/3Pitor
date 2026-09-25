// The shapes that cross the wire between the server and its clients (the UI and the check script).
// Types only, with no imports, so the browser bundle can import it with `import type`.

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out';

export interface Job {
  id: string;
  prompt: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  text?: string;
  error?: string;
  claudeSessionId?: string;
}

export type HostEvent =
  | { type: 'approval-request'; sessionId: string; approvalId: string; toolName: string; title: string; input: unknown }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string; allow: boolean }
  | { type: 'task'; sessionId: string; subtype: 'task_started' | 'task_notification'; description: string; subagentType: string }
  | { type: 'turn-finished'; sessionId: string; aborted: boolean }
  | { type: 'job-status'; jobId: string; status: JobStatus; error?: string };

// Messages a client may send over the event socket.
export type ClientMessage = { type: 'approval-response'; approvalId: string; allow: boolean };

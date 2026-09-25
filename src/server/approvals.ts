// Tool-use approvals: a chat turn asks, a client answers (over REST or the event socket),
// and anything unanswered is denied on timeout or when its turn ends.
import type { UIMessageStreamWriter } from 'ai';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { HostEvent } from '../shared/wire';
import type { EventBus } from './events';

interface PendingApproval {
  sessionId: string;
  resolve: (allow: boolean) => void;
}

export class Approvals {
  private pending = new Map<string, PendingApproval>();

  constructor(
    private events: EventBus,
    private timeoutMs: number,
  ) {}

  request(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    opts: { title?: string; signal: AbortSignal },
    writer: UIMessageStreamWriter,
  ): Promise<PermissionResult> {
    const approvalId = crypto.randomUUID();
    const event: HostEvent = {
      type: 'approval-request',
      sessionId,
      approvalId,
      toolName,
      title: opts.title ?? `Allow ${toolName}?`,
      input,
    };

    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => this.resolve(approvalId, false), this.timeoutMs);
      this.pending.set(approvalId, {
        sessionId,
        resolve: (allow) => {
          clearTimeout(timer);
          resolve(
            allow
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: 'The user denied this action.' },
          );
        },
      });
      opts.signal.addEventListener('abort', () => this.resolve(approvalId, false), { once: true });
      writer.write({ type: 'data-approval', data: event });
      this.events.emit(event);
    });
  }

  // Removing the entry before resolving makes the first answer win: a later answer, timeout,
  // or abort for the same approval finds nothing and returns false.
  resolve(approvalId: string, allow: boolean): boolean {
    const pending = this.pending.get(approvalId);
    if (!pending) return false;
    this.pending.delete(approvalId);
    pending.resolve(allow);
    this.events.emit({ type: 'approval-resolved', sessionId: pending.sessionId, approvalId, allow });
    return true;
  }

  denyPending(sessionId: string) {
    for (const [approvalId, pending] of this.pending) {
      if (pending.sessionId === sessionId) this.resolve(approvalId, false);
    }
  }
}

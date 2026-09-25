// Chat sessions: one turn at a time per session, resumed across turns through the Claude session id.
import { createUIMessageStream, streamText } from 'ai';
import type { Approvals } from './approvals';
import { claudeModel, claudeSessionIdOf, type ClaudeOptions } from './claude';
import type { EventBus } from './events';

export interface Session {
  id: string;
  claudeSessionId?: string;
  // Set while a turn is running; cleared when it ends.
  abort?: AbortController;
}

export class Sessions {
  private sessions = new Map<string, Session>();

  constructor(
    private options: ClaudeOptions,
    private events: EventBus,
    private approvals: Approvals,
  ) {}

  create(): Session {
    const session: Session = { id: crypto.randomUUID() };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  // One chat turn. Returns an AI SDK UI message stream that carries the model output
  // plus our own data parts (approvals, init info, the Claude session id).
  chat(sessionId: string, text: string): ReadableStream {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`unknown session ${sessionId}`);
    if (session.abort) throw new Error(`session ${sessionId} already has a turn in progress`);

    const abort = new AbortController();
    session.abort = abort;

    return createUIMessageStream({
      execute: async ({ writer }) => {
        const result = streamText({
          model: claudeModel(
            this.options,
            this.events,
            sessionId,
            {
              permissionMode: 'default',
              resume: session.claudeSessionId,
              canUseTool: (toolName, input, opts) => this.approvals.request(sessionId, toolName, input, opts, writer),
            },
            writer,
          ),
          prompt: text,
          abortSignal: abort.signal,
        });
        writer.merge(result.toUIMessageStream());

        let aborted = false;
        try {
          const finalStep = await result.finalStep;
          session.claudeSessionId = claudeSessionIdOf(finalStep) ?? session.claudeSessionId;
        } catch (error) {
          aborted = abort.signal.aborted;
          if (!aborted) throw error;
        } finally {
          session.abort = undefined;
          this.approvals.denyPending(sessionId);
        }
        writer.write({ type: 'data-session', data: { claudeSessionId: session.claudeSessionId, aborted } });
        this.events.emit({ type: 'turn-finished', sessionId, claudeSessionId: session.claudeSessionId, aborted });
      },
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    });
  }

  cancel(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.abort) return false;
    session.abort.abort();
    return true;
  }
}

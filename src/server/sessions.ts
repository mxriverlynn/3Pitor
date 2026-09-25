// Chat sessions: one turn at a time per session, with the conversation kept in memory and sent with
// every turn.
import { createUIMessageStream, stepCountIs, streamText, type ModelMessage } from 'ai';
import { agentSettings, type AgentOptions } from './agent';
import type { Approvals } from './approvals';
import type { EventBus } from './events';
import { EDIT_TOOLS } from './tools';

export interface Session {
  id: string;
  messages: ModelMessage[];
  // Set while a turn is running; cleared when it ends.
  abort?: AbortController;
}

export const DEFAULT_CHAT_MAX_STEPS = 20;

export interface SessionsOptions extends AgentOptions {
  // Model steps allowed in one chat turn; DEFAULT_CHAT_MAX_STEPS when unset.
  maxSteps?: number;
}

export class Sessions {
  private sessions = new Map<string, Session>();

  constructor(
    private options: SessionsOptions,
    private events: EventBus,
    private approvals: Approvals,
  ) {}

  create(): Session {
    const session: Session = { id: crypto.randomUUID(), messages: [] };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  // One chat turn. Returns an AI SDK UI message stream that carries the model output
  // plus our own data parts (approvals, subagent tasks, whether the turn was stopped).
  chat(sessionId: string, text: string): ReadableStream {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`unknown session ${sessionId}`);
    if (session.abort) throw new Error(`session ${sessionId} already has a turn in progress`);

    const abort = new AbortController();
    session.abort = abort;

    return createUIMessageStream({
      execute: async ({ writer }) => {
        const messages: ModelMessage[] = [...session.messages, { role: 'user', content: text }];
        const result = streamText({
          ...(await agentSettings(this.options, this.events, sessionId, writer)),
          messages,
          stopWhen: stepCountIs(this.options.maxSteps ?? DEFAULT_CHAT_MAX_STEPS),
          // Awaited inside the tool loop before a tool runs, so the turn waits while the user decides.
          toolApproval: async ({ toolCall }) => {
            if (!EDIT_TOOLS.has(toolCall.toolName)) return 'not-applicable';
            const allow = await this.approvals.request(sessionId, toolCall.toolName, toolCall.input, abort.signal, writer);
            return allow ? 'approved' : { type: 'denied', reason: 'The user denied this action.' };
          },
          abortSignal: abort.signal,
        });
        writer.merge(result.toUIMessageStream({ onError: errorMessage }));

        // The AI SDK only throws on a stop before the first step finishes; after that it resolves
        // normally, so the abort signal is the only reliable test. A stopped turn is forgotten.
        try {
          const responseMessages = await result.responseMessages;
          if (!abort.signal.aborted) session.messages = [...messages, ...responseMessages];
        } catch (error) {
          if (!abort.signal.aborted) throw error;
        } finally {
          session.abort = undefined;
          this.approvals.denyPending(sessionId);
        }
        const aborted = abort.signal.aborted;
        writer.write({ type: 'data-session', data: { aborted } });
        this.events.emit({ type: 'turn-finished', sessionId, aborted });
      },
      onError: errorMessage,
    });
  }

  cancel(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.abort) return false;
    session.abort.abort();
    return true;
  }
}

// Shown in the chat, so a bad API key or model id says what went wrong.
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

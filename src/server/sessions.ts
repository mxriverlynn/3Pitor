// Chat sessions: one turn at a time per session, with the conversation kept in memory and sent with
// every turn.
import { createUIMessageStream, stepCountIs, streamText, type ModelMessage } from 'ai';
import { agentSettings, modelErrorMessage, type AgentOptions } from './agent';
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
  // plus our own data parts (approvals, subagent tasks, whether the turn was stopped). `openFile` is the
  // document open in the editor; the turn tells the model about it, and the history keeps that per turn.
  chat(sessionId: string, text: string, openFile?: string): ReadableStream {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`unknown session ${sessionId}`);
    if (session.abort) throw new Error(`session ${sessionId} already has a turn in progress`);

    const abort = new AbortController();
    session.abort = abort;

    return createUIMessageStream({
      execute: async ({ writer }) => {
        const userTurn: ModelMessage = openFile
          ? {
              role: 'user',
              content: [
                { type: 'text', text },
                { type: 'text', text: `The file open in my editor is ${openFile}. When my message does not name a file, it means this file.` },
              ],
            }
          : { role: 'user', content: text };
        const messages: ModelMessage[] = [...session.messages, userTurn];
        let streamFailed = false;
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
          // Replaces the AI SDK's default, which prints the whole error with its stack trace.
          onError: ({ error }) => {
            streamFailed = true;
            console.error(modelErrorMessage(error));
          },
        });
        writer.merge(result.toUIMessageStream({ onError: modelErrorMessage }));

        // The AI SDK only throws on a stop before the first step finishes; after that it resolves
        // normally, so the abort signal is the only reliable test. A stopped turn is forgotten.
        try {
          const responseMessages = await result.responseMessages;
          if (!abort.signal.aborted) session.messages = [...messages, ...responseMessages];
        } catch (error) {
          // The stream already showed its error in the chat; throwing would add a vaguer second one.
          if (streamFailed && !abort.signal.aborted) return;
          if (!abort.signal.aborted) throw error;
        } finally {
          session.abort = undefined;
          this.approvals.denyPending(sessionId);
        }
        const aborted = abort.signal.aborted;
        writer.write({ type: 'data-session', data: { aborted } });
        this.events.emit({ type: 'turn-finished', sessionId, aborted });
      },
      onError: modelErrorMessage,
    });
  }

  cancel(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.abort) return false;
    session.abort.abort();
    return true;
  }
}
